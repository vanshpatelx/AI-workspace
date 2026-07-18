import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import type { Workspace } from "@ai-workspace/protocol";
import { CONFIG_DIR } from "./config.js";
import { FileService } from "./files.js";

const run = promisify(execFile);
const STORE_PATH = join(CONFIG_DIR, "workspaces.json");

/** Expand a leading ~ so users can type paths the way they do in a shell. */
export function expandPath(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

async function gitBranch(path: string): Promise<string | null> {
  try {
    // `branch --show-current` also works in a repo with no commits yet, where
    // `rev-parse HEAD` fails outright — freshly initialised projects are common.
    const { stdout } = await run("git", ["-C", path, "branch", "--show-current"], {
      timeout: 3000,
    });
    return stdout.trim() || null;
  } catch {
    return null; // not a git repo
  }
}

interface StoredWorkspace {
  workspaceId: string;
  path: string;
  sessionIds: string[];
  openedAt: number;
}

/**
 * The set of project directories this Worker is serving.
 *
 * A Worker is one per machine; workspaces are what the user actually works in.
 * Each has its own file root, terminals, chat sessions and agent working
 * directory, so several repos can be live on one machine at once.
 *
 * Workspaces are opened by path — there is no registration step. The open set
 * is persisted so a Worker restart brings the same projects back.
 */
export class WorkspaceRegistry {
  private readonly workspaces = new Map<string, StoredWorkspace>();
  private readonly files = new Map<string, FileService>();

  /** Store path is injectable so the registry can be pointed elsewhere. */
  constructor(private storePath: string = STORE_PATH) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.storePath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.storePath, "utf8")) as StoredWorkspace[];
      for (const w of raw) {
        // Drop entries whose directory has since been moved or deleted.
        if (existsSync(w.path)) this.workspaces.set(w.workspaceId, w);
      }
    } catch {
      // Corrupt store: start empty rather than refuse to boot.
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.storePath), { recursive: true });
      writeFileSync(this.storePath, JSON.stringify([...this.workspaces.values()], null, 2), "utf8");
    } catch (err) {
      console.error("[worker] failed to persist workspaces:", (err as Error).message);
    }
  }

  /** Open a directory as a workspace, or return the existing one for that path. */
  open(inputPath: string): StoredWorkspace {
    const path = expandPath(inputPath);
    if (!existsSync(path)) throw new Error(`no such directory: ${path}`);
    if (!statSync(path).isDirectory()) throw new Error(`not a directory: ${path}`);

    const existing = [...this.workspaces.values()].find((w) => w.path === path);
    if (existing) return existing;

    const record: StoredWorkspace = {
      workspaceId: `ws_${Math.random().toString(36).slice(2, 10)}`,
      path,
      sessionIds: [],
      openedAt: Date.now(),
    };
    this.workspaces.set(record.workspaceId, record);
    this.persist();
    return record;
  }

  close(workspaceId: string): void {
    this.workspaces.delete(workspaceId);
    this.files.delete(workspaceId);
    this.persist();
  }

  get(workspaceId: string): StoredWorkspace | undefined {
    return this.workspaces.get(workspaceId);
  }

  /** Path for a workspace, or throw — used to scope every workspace operation. */
  pathOf(workspaceId: string): string {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) throw new Error(`unknown workspace: ${workspaceId}`);
    return workspace.path;
  }

  /** File service scoped to this workspace, so traversal stays contained. */
  filesFor(workspaceId: string): FileService {
    let service = this.files.get(workspaceId);
    if (!service) {
      service = new FileService(this.pathOf(workspaceId));
      this.files.set(workspaceId, service);
    }
    return service;
  }

  addSession(workspaceId: string, sessionId: string): void {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace || workspace.sessionIds.includes(sessionId)) return;
    workspace.sessionIds.push(sessionId);
    this.persist();
  }

  ids(): string[] {
    return [...this.workspaces.keys()];
  }

  /** Full descriptions for the Desktop, including live git branch. */
  async list(activeTasks: Map<string, string>): Promise<Workspace[]> {
    return Promise.all(
      [...this.workspaces.values()].map(async (w) => ({
        workspaceId: w.workspaceId,
        path: w.path,
        name: basename(w.path) || w.path,
        branch: await gitBranch(w.path),
        activeTask: activeTasks.get(w.workspaceId) ?? null,
        sessionIds: w.sessionIds,
        openedAt: w.openedAt,
      })),
    );
  }
}
