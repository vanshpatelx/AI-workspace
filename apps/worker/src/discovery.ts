import { readdir, stat, open } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { DiscoveredProject, DiscoveredSession } from "@ai-workspace/protocol";

/**
 * Finds conversations the agent has already had on this machine.
 *
 * Claude Code keeps one JSONL file per session under ~/.claude/projects. Those
 * files are the same sessions `--resume` accepts, so surfacing them lets the
 * user reopen a project and carry on a conversation started weeks ago in a
 * terminal, outside this app entirely.
 *
 * Everything here is read-only and local; nothing is copied or uploaded.
 */

/** Transcripts reach tens of megabytes, so only the head of each is read. */
const HEAD_BYTES = 64 * 1024;
/** Newest sessions first, and stop well before scanning hundreds of files. */
const MAX_SESSIONS_PER_PROJECT = 12;
const MAX_PROJECTS = 60;

function projectsRoot(): string {
  return join(process.env.AIW_CLAUDE_HOME ?? join(homedir(), ".claude"), "projects");
}

/** Read at most `bytes` from the front of a file. */
async function readHead(path: string, bytes: number): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

interface HeadFacts {
  cwd: string | null;
  title: string | null;
  firstPrompt: string | null;
  userMessages: number;
}

/**
 * Pull the few facts worth showing from the head of a transcript.
 *
 * The directory name encodes the path lossily (both `/` and spaces become `-`),
 * so `cwd` from inside the file is the only trustworthy source.
 */
function readFacts(head: string): HeadFacts {
  const facts: HeadFacts = { cwd: null, title: null, firstPrompt: null, userMessages: 0 };
  // The last line of a bounded read is usually truncated; drop it.
  const lines = head.split("\n").slice(0, -1);

  for (const line of lines) {
    if (!line.trim()) continue;
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (!facts.cwd && typeof event.cwd === "string") facts.cwd = event.cwd;
    if (!facts.title && typeof event.aiTitle === "string") facts.title = event.aiTitle;

    if (event.type === "user") {
      facts.userMessages++;
      if (!facts.firstPrompt) {
        const content = event.message?.content;
        const text =
          typeof content === "string"
            ? content
            : Array.isArray(content)
              ? (content.find((c: any) => c?.type === "text")?.text ?? "")
              : "";
        // Skip tool-result turns, which are synthetic user messages.
        const clean = String(text).replace(/\s+/g, " ").trim();
        if (clean) facts.firstPrompt = clean.slice(0, 140);
      }
    }
  }
  return facts;
}

async function readSession(path: string): Promise<{ session: DiscoveredSession; cwd: string } | null> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size === 0) return null;

    const facts = readFacts(await readHead(path, HEAD_BYTES));
    if (!facts.cwd) return null; // can't attribute it to a project

    const session: DiscoveredSession = {
      // The filename is the session id `claude --resume` expects.
      sessionId: basename(path, ".jsonl"),
      title: facts.title,
      firstPrompt: facts.firstPrompt,
      messageCount: facts.userMessages,
      /** True when the head was cut short, so counts are a floor. */
      truncated: info.size > HEAD_BYTES,
      updatedAt: info.mtimeMs,
      sizeBytes: info.size,
    };
    return { session, cwd: facts.cwd };
  } catch {
    return null; // unreadable file — skip rather than fail the scan
  }
}

/**
 * Group every past session by the directory it ran in, newest first.
 * Projects whose directory no longer exists are dropped.
 */
export async function discoverProjects(): Promise<DiscoveredProject[]> {
  const root = projectsRoot();
  if (!existsSync(root)) return [];

  let dirs: string[];
  try {
    dirs = await readdir(root);
  } catch {
    return [];
  }

  const byPath = new Map<string, DiscoveredProject>();

  await Promise.all(
    dirs.slice(0, MAX_PROJECTS).map(async (dir) => {
      const dirPath = join(root, dir);
      let files: string[];
      try {
        files = (await readdir(dirPath)).filter((f) => f.endsWith(".jsonl"));
      } catch {
        return;
      }

      // Newest first, so the cap keeps the sessions that matter.
      const withTimes = await Promise.all(
        files.map(async (f) => {
          const p = join(dirPath, f);
          try {
            return { path: p, mtime: (await stat(p)).mtimeMs };
          } catch {
            return { path: p, mtime: 0 };
          }
        }),
      );
      withTimes.sort((a, b) => b.mtime - a.mtime);

      const results = await Promise.all(
        withTimes.slice(0, MAX_SESSIONS_PER_PROJECT).map((f) => readSession(f.path)),
      );

      for (const result of results) {
        if (!result) continue;
        const { session, cwd } = result;
        if (!existsSync(cwd)) continue; // project has been moved or deleted

        const existing = byPath.get(cwd);
        if (existing) {
          existing.sessions.push(session);
          existing.updatedAt = Math.max(existing.updatedAt, session.updatedAt);
        } else {
          byPath.set(cwd, {
            path: cwd,
            name: basename(cwd) || cwd,
            sessions: [session],
            updatedAt: session.updatedAt,
          });
        }
      }
    }),
  );

  const projects = [...byPath.values()];
  for (const project of projects) project.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  projects.sort((a, b) => b.updatedAt - a.updatedAt);
  return projects;
}
