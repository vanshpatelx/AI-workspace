import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWorker, type RunningWorker } from "./server.js";
import type { WorkerConfig } from "./config.js";
import type { ClientMessage, ServerMessage } from "@ai-workspace/protocol";

/**
 * Drives a real Worker over a real socket. Unit tests cover the pieces; this
 * covers the thing users actually hit — authentication, and whether a
 * workspace really confines what a client can reach.
 */
const PORT = 4977;
const CODE = "AIW-TEST-CODE";

let worker: RunningWorker;
let projectA: string;
let projectB: string;
let home: string;

/** Connect, optionally authenticate, and collect messages. */
function client(token?: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${PORT}`);
  const received: ServerMessage[] = [];
  const ready = new Promise<void>((resolve, reject) => {
    socket.on("open", () => {
      if (token !== undefined) {
        socket.send(JSON.stringify({ type: "hello", clientId: "test", token } as ClientMessage));
      }
      resolve();
    });
    socket.on("error", reject);
  });
  socket.on("message", (raw) => received.push(JSON.parse(raw.toString())));

  const send = (msg: ClientMessage) => socket.send(JSON.stringify(msg));
  const waitFor = async <T extends ServerMessage["type"]>(type: T, ms = 4000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const hit = received.find((m) => m.type === type);
      if (hit) return hit as Extract<ServerMessage, { type: T }>;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`timed out waiting for ${type}; got ${received.map((m) => m.type).join(",")}`);
  };
  return { socket, received, ready, send, waitFor, close: () => socket.close() };
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "aiw-int-"));
  const base = mkdtempSync(join(tmpdir(), "aiw-int-proj-"));
  projectA = join(base, "alpha");
  projectB = join(base, "beta");
  mkdirSync(projectA, { recursive: true });
  mkdirSync(projectB, { recursive: true });
  writeFileSync(join(projectA, "ALPHA.md"), "alpha\n");
  writeFileSync(join(projectB, "BETA.md"), "beta\n");

  process.env.AIW_HOME = home;
  const config: WorkerConfig = {
    workerId: "w_test",
    port: PORT,
    transport: "local",
    keepAwake: "off",
    agents: [],
    pairingCode: CODE,
    createdAt: new Date(0).toISOString(),
  };
  worker = startWorker(config);
  await new Promise((r) => setTimeout(r, 300));
});

afterAll(async () => {
  await worker.stop();
  rmSync(home, { recursive: true, force: true });
  delete process.env.AIW_HOME;
});

describe("authentication", () => {
  it("accepts the pairing code", async () => {
    const c = client(CODE);
    await c.ready;
    expect((await c.waitFor("auth.result")).ok).toBe(true);
    c.close();
  });

  it("rejects a wrong pairing code", async () => {
    const c = client("AIW-WRONG-CODE");
    await c.ready;
    const result = await c.waitFor("auth.result");
    expect(result.ok).toBe(false);
    c.close();
  });

  it("sends no workspace state before authentication", async () => {
    const c = client(); // never says hello
    await c.ready;
    await new Promise((r) => setTimeout(r, 600));
    expect(c.received.filter((m) => m.type === "workspaces")).toHaveLength(0);
    expect(c.received.filter((m) => m.type === "machine")).toHaveLength(0);
    c.close();
  });

  it("refuses actions from an unauthenticated client", async () => {
    const c = client();
    await c.ready;
    c.send({ type: "fs.list", requestId: "r1", workspaceId: "anything", path: "" });
    const result = await c.waitFor("auth.result");
    expect(result.ok).toBe(false);
    c.close();
  });
});

describe("workspaces over the wire", () => {
  it("opens a workspace and reports it", async () => {
    const c = client(CODE);
    await c.ready;
    await c.waitFor("auth.result");
    c.send({ type: "workspace.open", requestId: "w1", path: projectA });
    const opened = await c.waitFor("workspace.opened");
    expect(opened.workspace.path).toBe(projectA);
    expect(opened.workspace.name).toBe("alpha");
    c.close();
  });

  it("reports an error for a path that does not exist", async () => {
    const c = client(CODE);
    await c.ready;
    await c.waitFor("auth.result");
    c.send({ type: "workspace.open", requestId: "w2", path: "/nope/not/here" });
    expect((await c.waitFor("workspace.error")).message).toMatch(/no such directory/i);
    c.close();
  });

  it("confines file listing to the workspace that was opened", async () => {
    const c = client(CODE);
    await c.ready;
    await c.waitFor("auth.result");

    c.send({ type: "workspace.open", requestId: "wa", path: projectA });
    const a = await c.waitFor("workspace.opened");
    c.send({ type: "fs.list", requestId: "la", workspaceId: a.workspace.workspaceId, path: "" });
    const listing = await c.waitFor("fs.listing");

    const names = listing.entries.map((e) => e.name);
    expect(names).toContain("ALPHA.md");
    // The other project is open on the same Worker but must not leak in.
    expect(names).not.toContain("BETA.md");
    c.close();
  });

  it("refuses to escape a workspace root over the wire", async () => {
    const c = client(CODE);
    await c.ready;
    await c.waitFor("auth.result");
    c.send({ type: "workspace.open", requestId: "wb", path: projectA });
    const a = await c.waitFor("workspace.opened");

    c.send({
      type: "fs.read",
      requestId: "rr",
      workspaceId: a.workspace.workspaceId,
      path: "../../../../etc/passwd",
    });
    expect((await c.waitFor("fs.error")).message).toBeTruthy();
    c.close();
  });

  it("refuses operations against an unknown workspace", async () => {
    const c = client(CODE);
    await c.ready;
    await c.waitFor("auth.result");
    c.send({ type: "fs.list", requestId: "lx", workspaceId: "ws_bogus", path: "" });
    expect((await c.waitFor("fs.error")).message).toMatch(/unknown workspace/i);
    c.close();
  });

  it("creates independent sessions within a workspace", async () => {
    const c = client(CODE);
    await c.ready;
    await c.waitFor("auth.result");
    c.send({ type: "workspace.open", requestId: "wc", path: projectB });
    const b = await c.waitFor("workspace.opened");

    c.send({ type: "session.create", requestId: "s1", workspaceId: b.workspace.workspaceId });
    const created = await c.waitFor("session.created");
    expect(created.sessionId).toBeTruthy();
    expect(created.workspaceId).toBe(b.workspace.workspaceId);
    c.close();
  });
});

describe("commands", () => {
  it("runs a safe command in the workspace directory", async () => {
    const c = client(CODE);
    await c.ready;
    await c.waitFor("auth.result");
    c.send({ type: "workspace.open", requestId: "wd", path: projectA });
    const a = await c.waitFor("workspace.opened");

    c.send({
      type: "command.run",
      workspaceId: a.workspace.workspaceId,
      commandId: "c1",
      command: "pwd",
    });
    const result = await c.waitFor("command.result", 8000);
    expect(result.approved).toBe(true);
    expect(result.output).toContain("alpha");
    c.close();
  });

  it("holds a dangerous command for approval instead of running it", async () => {
    const c = client(CODE);
    await c.ready;
    await c.waitFor("auth.result");
    c.send({ type: "workspace.open", requestId: "we", path: projectA });
    const a = await c.waitFor("workspace.opened");

    c.send({
      type: "command.run",
      workspaceId: a.workspace.workspaceId,
      commandId: "c2",
      command: "rm -rf ALPHA.md",
    });
    // An approval request must appear, and no result until it is answered.
    const request = await c.waitFor("approval.request", 6000);
    expect(request.request.kind).toBe("file-delete");
    expect(c.received.find((m) => m.type === "command.result")).toBeUndefined();

    c.send({ type: "approval.resolve", requestId: request.request.id, approved: false });
    const result = await c.waitFor("command.result", 6000);
    expect(result.approved).toBe(false);
    c.close();
  });
});
