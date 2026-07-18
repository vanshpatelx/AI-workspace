import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { WorkspaceRegistry, expandPath } from "./workspaces.js";

let home: string;
let store: string;
let projectA: string;
let projectB: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "aiw-home-"));
  store = join(home, "workspaces.json");
  const base = mkdtempSync(join(tmpdir(), "aiw-projects-"));
  projectA = join(base, "alpha");
  projectB = join(base, "beta");
  mkdirSync(projectA, { recursive: true });
  mkdirSync(projectB, { recursive: true });
  writeFileSync(join(projectA, "A.txt"), "a");
  writeFileSync(join(projectB, "B.txt"), "b");
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("expandPath", () => {
  it("expands a leading ~ the way a shell would", () => {
    expect(expandPath("~")).toBe(homedir());
    expect(expandPath("~/code")).toBe(join(homedir(), "code"));
  });

  it("leaves absolute paths alone", () => {
    expect(expandPath("/tmp")).toBe("/tmp");
  });

  it("does not expand a ~ that is not the path root", () => {
    expect(expandPath("/tmp/~backup")).toBe("/tmp/~backup");
  });
});

describe("WorkspaceRegistry", () => {
  it("opens a directory as a workspace", () => {
    const registry = new WorkspaceRegistry(store);
    const workspace = registry.open(projectA);
    expect(workspace.path).toBe(projectA);
    expect(registry.pathOf(workspace.workspaceId)).toBe(projectA);
  });

  it("returns the existing workspace when the same path is opened twice", () => {
    const registry = new WorkspaceRegistry(store);
    const first = registry.open(projectA);
    const second = registry.open(projectA);
    expect(second.workspaceId).toBe(first.workspaceId);
    expect(registry.ids()).toHaveLength(1);
  });

  it("keeps several projects open at once — the whole point of workspaces", () => {
    const registry = new WorkspaceRegistry(store);
    registry.open(projectA);
    registry.open(projectB);
    expect(registry.ids()).toHaveLength(2);
  });

  it("gives each workspace a file service rooted at its own directory", async () => {
    const registry = new WorkspaceRegistry(store);
    const a = registry.open(projectA);
    const b = registry.open(projectB);

    const listA = await registry.filesFor(a.workspaceId).list("");
    const listB = await registry.filesFor(b.workspaceId).list("");

    expect(listA.entries.map((e) => e.name)).toEqual(["A.txt"]);
    expect(listB.entries.map((e) => e.name)).toEqual(["B.txt"]);
  });

  it("rejects a path that does not exist", () => {
    const registry = new WorkspaceRegistry(store);
    expect(() => registry.open("/definitely/not/here")).toThrow(/no such directory/i);
  });

  it("rejects a file as a workspace", () => {
    const registry = new WorkspaceRegistry(store);
    expect(() => registry.open(join(projectA, "A.txt"))).toThrow(/not a directory/i);
  });

  it("throws for an unknown workspace instead of acting on a default", () => {
    const registry = new WorkspaceRegistry(store);
    expect(() => registry.pathOf("ws_nope")).toThrow(/unknown workspace/i);
  });

  it("remembers open workspaces across a restart", () => {
    const first = new WorkspaceRegistry(store);
    const workspace = first.open(projectA);
    const reopened = new WorkspaceRegistry(store);
    expect(reopened.pathOf(workspace.workspaceId)).toBe(projectA);
  });

  it("drops workspaces whose directory has gone away", () => {
    const first = new WorkspaceRegistry(store);
    first.open(projectA);
    rmSync(projectA, { recursive: true, force: true });
    expect(new WorkspaceRegistry(store).ids()).toHaveLength(0);
  });

  it("closing a workspace removes it", () => {
    const registry = new WorkspaceRegistry(store);
    const workspace = registry.open(projectA);
    registry.close(workspace.workspaceId);
    expect(registry.ids()).toHaveLength(0);
  });

  // Regression: `git rev-parse HEAD` fails in a repo with no commits, so a
  // freshly initialised project reported no branch at all.
  it("reports the branch of a repo that has no commits yet", async () => {
    execFileSync("git", ["init", "-q"], { cwd: projectA });
    execFileSync("git", ["checkout", "-qb", "fresh-branch"], { cwd: projectA });

    const registry = new WorkspaceRegistry(store);
    registry.open(projectA);
    const [listed] = await registry.list(new Map());
    expect(listed?.branch).toBe("fresh-branch");
  });

  it("reports no branch for a directory that is not a repo", async () => {
    const registry = new WorkspaceRegistry(store);
    registry.open(projectB);
    const [listed] = await registry.list(new Map());
    expect(listed?.branch).toBeNull();
  });

  it("surfaces what a workspace is currently doing", async () => {
    const registry = new WorkspaceRegistry(store);
    const workspace = registry.open(projectA);
    const [listed] = await registry.list(new Map([[workspace.workspaceId, "agent running"]]));
    expect(listed?.activeTask).toBe("agent running");
  });
});
