import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, relative, extname, sep } from "node:path";
import type { FileEntry } from "@ai-workspace/protocol";

/** Preview cap — large files are refused rather than streamed to the UI. */
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;

const TEXT_EXT = new Set([
  ".txt", ".md", ".markdown", ".json", ".yaml", ".yml", ".toml", ".ini", ".env",
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".css", ".scss", ".html", ".xml",
  ".py", ".rb", ".go", ".rs", ".java", ".c", ".h", ".cpp", ".sh", ".zsh", ".bash",
  ".sql", ".graphql", ".vue", ".svelte", ".lock", ".gitignore", ".dockerfile",
]);

const BINARY_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

/** Directories that are noise in a repo browser. */
const SKIP = new Set([".git", "node_modules", ".DS_Store", ".pnpm-store"]);

export class FileService {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /**
   * Resolve a client-supplied path inside the workspace root.
   *
   * This is the security boundary for the whole file surface: anything that
   * escapes the root (via `..`, an absolute path, or a symlink) is rejected.
   */
  private safeResolve(input: string): string {
    const cleaned = (input ?? "").replace(/^[/\\]+/, "");
    const target = resolve(this.root, cleaned);
    const rel = relative(this.root, target);
    if (rel.startsWith("..") || (rel !== "" && rel.split(sep)[0] === "..")) {
      throw new Error("path is outside the workspace");
    }
    return target;
  }

  async list(path: string): Promise<{ path: string; entries: FileEntry[] }> {
    const dir = this.safeResolve(path);
    const dirents = await readdir(dir, { withFileTypes: true });

    const entries: FileEntry[] = [];
    for (const d of dirents) {
      if (SKIP.has(d.name)) continue;
      let size = 0;
      if (d.isFile()) {
        try {
          size = (await stat(join(dir, d.name))).size;
        } catch {
          continue; // broken symlink, permission denied, etc.
        }
      }
      entries.push({ name: d.name, kind: d.isDirectory() ? "dir" : "file", size });
    }

    // Directories first, then alphabetical.
    entries.sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1,
    );
    return { path: relative(this.root, dir), entries };
  }

  async read(
    path: string,
  ): Promise<{ path: string; mime: string; base64: boolean; content: string }> {
    const file = this.safeResolve(path);
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    if (info.size > MAX_PREVIEW_BYTES) {
      throw new Error(`file is too large to preview (${Math.round(info.size / 1024)} KB)`);
    }

    const ext = extname(file).toLowerCase();
    const rel = relative(this.root, file);

    const binaryMime = BINARY_MIME[ext];
    if (binaryMime) {
      const buf = await readFile(file);
      return { path: rel, mime: binaryMime, base64: true, content: buf.toString("base64") };
    }

    if (TEXT_EXT.has(ext) || ext === "" || info.size < 256 * 1024) {
      const text = await readFile(file, "utf8");
      const mime = ext === ".md" || ext === ".markdown" ? "text/markdown" : "text/plain";
      return { path: rel, mime, base64: false, content: text };
    }

    throw new Error(`cannot preview ${ext || "this file type"}`);
  }
}
