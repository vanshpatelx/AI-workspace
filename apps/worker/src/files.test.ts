import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileService } from "./files.js";

/**
 * The file surface is the most dangerous thing the Worker exposes: it reads
 * from disk on behalf of a remote client. Everything here is about the
 * boundary holding.
 */
let root: string;
let outside: string;
let files: FileService;

beforeAll(() => {
  const base = mkdtempSync(join(tmpdir(), "aiw-files-"));
  root = join(base, "workspace");
  outside = join(base, "secret");
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(root, "README.md"), "# hello\n");
  writeFileSync(join(root, "src", "index.ts"), "export const x = 1;\n");
  writeFileSync(join(outside, "credentials.txt"), "SUPER SECRET\n");
  files = new FileService(root);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("FileService path containment", () => {
  it("lists files inside the workspace", async () => {
    const { entries } = await files.list("");
    expect(entries.map((e) => e.name)).toContain("README.md");
  });

  it("reads a file inside the workspace", async () => {
    const file = await files.read("README.md");
    expect(file.content).toContain("hello");
    expect(file.base64).toBe(false);
  });

  it.each([
    ["relative traversal", "../secret/credentials.txt"],
    ["nested traversal", "src/../../secret/credentials.txt"],
    ["deep traversal", "../../../../../../etc/passwd"],
    ["absolute path", "/etc/passwd"],
    ["absolute path to sibling", "/tmp"],
  ])("refuses to read via %s", async (_label, path) => {
    await expect(files.read(path)).rejects.toThrow();
  });

  it.each([
    ["relative traversal", "../secret"],
    ["deep traversal", "../../../../etc"],
    ["absolute path", "/etc"],
  ])("refuses to list via %s", async (_label, path) => {
    await expect(files.list(path)).rejects.toThrow();
  });

  it("never leaks content from outside the root", async () => {
    for (const path of ["../secret/credentials.txt", "/etc/passwd"]) {
      await expect(files.read(path)).rejects.toThrow();
    }
  });

  it("hides noise directories from listings", async () => {
    mkdirSync(join(root, "node_modules"), { recursive: true });
    mkdirSync(join(root, ".git"), { recursive: true });
    const { entries } = await files.list("");
    const names = entries.map((e) => e.name);
    expect(names).not.toContain("node_modules");
    expect(names).not.toContain(".git");
  });

  it("sorts directories before files", async () => {
    const { entries } = await files.list("");
    const firstFile = entries.findIndex((e) => e.kind === "file");
    const lastDir = entries.map((e) => e.kind).lastIndexOf("dir");
    if (firstFile !== -1 && lastDir !== -1) expect(lastDir).toBeLessThan(firstFile);
  });

  it("refuses a directory as a file read", async () => {
    await expect(files.read("src")).rejects.toThrow(/not a file/i);
  });
});
