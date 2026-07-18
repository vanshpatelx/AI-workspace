import { describe, it, expect } from "vitest";
import { classifyCommand, ApprovalManager } from "./approvals.js";

/**
 * If this classifier regresses, destructive commands stop being gated and run
 * silently — so the dangerous cases matter far more than the safe ones.
 */
describe("classifyCommand", () => {
  it.each([
    ["git push", "git-push"],
    ["git push --force origin main", "git-push"],
    ["rm -rf build", "file-delete"],
    ["rm -f /tmp/thing.txt", "file-delete"],
    ["rm -r node_modules", "file-delete"],
    ["docker ps", "docker-command"],
    ["docker compose down", "docker-command"],
    ["npm install left-pad", "package-install"],
    ["pnpm add react", "package-install"],
    ["yarn add lodash", "package-install"],
    ["brew install jq", "package-install"],
    ["pip install requests", "package-install"],
  ])("gates %s", (command, kind) => {
    expect(classifyCommand(command)?.kind).toBe(kind);
  });

  it.each([
    ["git status"],
    ["git log --oneline"],
    ["ls -la"],
    ["echo hello"],
    ["cat README.md"],
    ["npm run build"],
    ["npm test"],
    ["pnpm typecheck"],
  ])("allows %s to run without approval", (command) => {
    expect(classifyCommand(command)).toBeNull();
  });

  it("gates a dangerous command even when chained after a safe one", () => {
    expect(classifyCommand("git status && git push")).not.toBeNull();
  });

  // Regression: a dangerous word inside an argument is not a dangerous
  // command. Searching a CI file for "docker push" was being gated, so the
  // user had to approve a grep.
  it.each([
    ['grep -n "docker build\\|docker push" .github/workflows/ci.yaml'],
    ["grep 'docker run' Makefile"],
    ['echo "docker is not running here"'],
    ['rg "docker-compose up" --files-with-matches'],
  ])("does not gate %s — the word is only an argument", (command) => {
    expect(classifyCommand(command)).toBeNull();
  });

  it.each([
    ["docker ps"],
    ["sudo docker run -it ubuntu"],
    ["ls && docker compose up"],
    ["cd app; docker build ."],
  ])("still gates %s — docker is the command", (command) => {
    expect(classifyCommand(command)?.kind).toBe("docker-command");
  });

  it("carries a human-readable summary for the UI", () => {
    expect(classifyCommand("rm -rf dist")?.summary).toMatch(/delete/i);
  });
});

describe("ApprovalManager", () => {
  it("resolves the pending decision when approved", async () => {
    const approvals = new ApprovalManager();
    const { request, decision } = approvals.create("w1", "git-push", "Push", "git push", 1);
    approvals.resolve(request.id, true);
    await expect(decision).resolves.toBe(true);
  });

  it("resolves false when rejected", async () => {
    const approvals = new ApprovalManager();
    const { request, decision } = approvals.create("w1", "file-delete", "Delete", "rm x", 1);
    approvals.resolve(request.id, false);
    await expect(decision).resolves.toBe(false);
  });

  it("reports unknown request ids rather than hanging", () => {
    const approvals = new ApprovalManager();
    expect(approvals.resolve("does-not-exist", true)).toBe(false);
  });

  it("only resolves a request once", () => {
    const approvals = new ApprovalManager();
    const { request } = approvals.create("w1", "other", "x", "y", 1);
    expect(approvals.resolve(request.id, true)).toBe(true);
    expect(approvals.resolve(request.id, true)).toBe(false);
  });

  it("lists pending requests so a reconnecting Desktop sees them", () => {
    const approvals = new ApprovalManager();
    approvals.create("w1", "git-push", "Push", "git push", 1);
    expect(approvals.list()).toHaveLength(1);
  });

  it("denies everything still pending on shutdown, never silently allows", async () => {
    const approvals = new ApprovalManager();
    const { decision } = approvals.create("w1", "file-delete", "Delete", "rm -rf /", 1);
    approvals.rejectAll();
    await expect(decision).resolves.toBe(false);
  });

  it("tags a request with the workspace it came from", () => {
    const approvals = new ApprovalManager();
    const { request } = approvals.create("w1", "git-push", "Push", "git push", 1, "ws_abc");
    expect(request.workspaceId).toBe("ws_abc");
  });
});
