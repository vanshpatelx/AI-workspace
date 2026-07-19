import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverProjects } from "./discovery.js";

let claudeHome: string;
let projectDir: string;

/** One JSONL line as the agent writes it. */
const line = (o: unknown) => `${JSON.stringify(o)}\n`;

beforeEach(() => {
  claudeHome = mkdtempSync(join(tmpdir(), "aiw-claude-"));
  projectDir = mkdtempSync(join(tmpdir(), "aiw-proj-"));
  mkdirSync(join(claudeHome, "projects", "-encoded-name"), { recursive: true });
  process.env.AIW_CLAUDE_HOME = claudeHome;
});

afterEach(() => {
  rmSync(claudeHome, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
  delete process.env.AIW_CLAUDE_HOME;
});

function writeSession(id: string, opts: { cwd: string; title?: string; prompts?: string[] }) {
  const parts = [
    line({ type: "system", subtype: "init", cwd: opts.cwd, session_id: id }),
    ...(opts.title ? [line({ type: "ai-title", aiTitle: opts.title, sessionId: id })] : []),
    ...(opts.prompts ?? []).map((p) =>
      line({ type: "user", message: { role: "user", content: p } }),
    ),
  ];
  writeFileSync(join(claudeHome, "projects", "-encoded-name", `${id}.jsonl`), parts.join(""));
}

describe("discovering past agent conversations", () => {
  it("groups sessions by the directory they ran in", async () => {
    writeSession("aaaaaaaa-1111-4111-8111-111111111111", {
      cwd: projectDir,
      title: "Fix the login bug",
      prompts: ["fix login"],
    });

    const projects = await discoverProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]?.path).toBe(projectDir);
    expect(projects[0]?.sessions[0]?.title).toBe("Fix the login bug");
  });

  it("uses the session id the agent can resume", async () => {
    const id = "bbbbbbbb-2222-4222-8222-222222222222";
    writeSession(id, { cwd: projectDir, prompts: ["hello"] });
    const [project] = await discoverProjects();
    // The filename is the id `claude --resume` accepts — not a derived value.
    expect(project?.sessions[0]?.sessionId).toBe(id);
  });

  it("falls back to the first prompt when there is no title", async () => {
    writeSession("cccccccc-3333-4333-8333-333333333333", {
      cwd: projectDir,
      prompts: ["refactor the payment module"],
    });
    const [project] = await discoverProjects();
    expect(project?.sessions[0]?.title).toBeNull();
    expect(project?.sessions[0]?.firstPrompt).toBe("refactor the payment module");
  });

  it("reads cwd from inside the file, not the directory name", async () => {
    // The directory name replaces both slashes and spaces with dashes, so it
    // cannot be decoded back into a path — only cwd is trustworthy.
    writeSession("dddddddd-4444-4444-8444-444444444444", {
      cwd: projectDir,
      prompts: ["x"],
    });
    const [project] = await discoverProjects();
    expect(project?.path).toBe(projectDir);
    expect(project?.path).not.toContain("-encoded-name");
  });

  it("drops projects whose directory has been deleted", async () => {
    writeSession("eeeeeeee-5555-4555-8555-555555555555", {
      cwd: join(projectDir, "gone"),
      prompts: ["x"],
    });
    expect(await discoverProjects()).toHaveLength(0);
  });

  it("ignores a session with no cwd rather than guessing", async () => {
    writeFileSync(
      join(claudeHome, "projects", "-encoded-name", "ffffffff-6666-4666-8666-666666666666.jsonl"),
      line({ type: "user", message: { role: "user", content: "orphan" } }),
    );
    expect(await discoverProjects()).toHaveLength(0);
  });

  it("survives malformed lines", async () => {
    writeFileSync(
      join(claudeHome, "projects", "-encoded-name", "99999999-7777-4777-8777-777777777777.jsonl"),
      `not json at all\n${line({ type: "system", cwd: projectDir })}${line({ type: "user", message: { role: "user", content: "ok" } })}`,
    );
    const projects = await discoverProjects();
    expect(projects[0]?.path).toBe(projectDir);
  });

  it("returns nothing when there is no agent history", async () => {
    rmSync(join(claudeHome, "projects"), { recursive: true, force: true });
    expect(await discoverProjects()).toEqual([]);
  });

  it("orders projects by most recently used", async () => {
    const other = mkdtempSync(join(tmpdir(), "aiw-proj2-"));
    writeSession("11111111-8888-4888-8888-888888888888", { cwd: projectDir, prompts: ["old"] });
    await new Promise((r) => setTimeout(r, 15));
    writeSession("22222222-9999-4999-8999-999999999999", { cwd: other, prompts: ["new"] });

    const projects = await discoverProjects();
    expect(projects[0]?.path).toBe(other);
    rmSync(other, { recursive: true, force: true });
  });
});
