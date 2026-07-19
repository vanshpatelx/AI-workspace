import { useCallback, useEffect, useState } from "react";
import { ChevronRight, File, Folder, FolderOpen, Loader2, RefreshCw } from "lucide-react";
import type { FileEntry } from "@ai-workspace/protocol";
import type { WorkersApi } from "../lib/useWorkers.js";

/**
 * The workspace as a tree that expands in place.
 *
 * The previous browser navigated *into* a directory, which meant opening a file
 * three levels down cost three clicks and lost sight of everything else. An
 * editor's explorer has to stay put while you work, so folders expand where
 * they are and the whole shape of the repo remains visible.
 *
 * Children are fetched the first time a folder opens and then kept, because a
 * listing crosses the network and re-fetching on every toggle makes expanding
 * feel slow for no benefit.
 */

const INDENT = 10;

function sortEntries(entries: FileEntry[]): FileEntry[] {
  // Directories first, then alphabetical — the ordering every file explorer uses.
  return [...entries].sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1,
  );
}

function join(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

export function FileTree({
  url,
  workspaceId,
  fs,
  connected,
  activePath,
  dirtyPaths,
  onOpenFile,
}: {
  url: string;
  workspaceId: string;
  fs: WorkersApi["fs"];
  connected: boolean;
  /** File currently in the editor, highlighted in the tree. */
  activePath: string | null;
  /** Open files with unsaved changes, marked with a dot. */
  dirtyPaths: string[];
  onOpenFile: (path: string) => void;
}) {
  /** Listing per directory path; "" is the workspace root. */
  const [children, setChildren] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (dir: string, force = false) => {
      if (!connected || (!force && children[dir])) return;
      setLoading((prev) => new Set(prev).add(dir));
      try {
        const listing = await fs.list(url, workspaceId, dir);
        setChildren((prev) => ({ ...prev, [dir]: sortEntries(listing.entries) }));
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading((prev) => {
          const next = new Set(prev);
          next.delete(dir);
          return next;
        });
      }
    },
    [connected, children, fs, url, workspaceId],
  );

  // Load the root once the connection is up. Deliberately not depending on
  // `load`, whose identity changes with every listing that arrives.
  useEffect(() => {
    if (connected) void load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, url, workspaceId]);

  const toggle = (dir: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else {
        next.add(dir);
        void load(dir);
      }
      return next;
    });
  };

  const renderDir = (dir: string, depth: number) => {
    const entries = children[dir];
    if (loading.has(dir) && !entries) {
      return (
        <div
          className="flex items-center gap-1.5 py-0.5 text-[11px] text-muted-foreground"
          style={{ paddingLeft: depth * INDENT + 8 }}
        >
          <Loader2 className="h-3 w-3 animate-spin" /> loading…
        </div>
      );
    }
    if (!entries) return null;
    if (entries.length === 0) {
      return (
        <div
          className="py-0.5 text-[11px] italic text-muted-foreground"
          style={{ paddingLeft: depth * INDENT + 20 }}
        >
          empty
        </div>
      );
    }

    return entries.map((entry) => {
      const full = join(dir, entry.name);
      if (entry.kind === "dir") {
        const open = expanded.has(full);
        return (
          <div key={full}>
            <button
              onClick={() => toggle(full)}
              className="flex w-full items-center gap-1 rounded-sm py-0.5 pr-2 text-left text-[12px] hover:bg-accent/50"
              style={{ paddingLeft: depth * INDENT + 4 }}
            >
              <ChevronRight
                className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${
                  open ? "rotate-90" : ""
                }`}
              />
              {open ? (
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-sky-400" />
              ) : (
                <Folder className="h-3.5 w-3.5 shrink-0 text-sky-400" />
              )}
              <span className="truncate">{entry.name}</span>
            </button>
            {open && renderDir(full, depth + 1)}
          </div>
        );
      }

      const isActive = activePath === full;
      const isDirty = dirtyPaths.includes(full);
      return (
        <button
          key={full}
          onClick={() => onOpenFile(full)}
          title={full}
          className={`flex w-full items-center gap-1 rounded-sm py-0.5 pr-2 text-left text-[12px] ${
            isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
          }`}
          // Aligned with folder names, past the space their chevron occupies.
          style={{ paddingLeft: depth * INDENT + 4 + 16 }}
        >
          <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{entry.name}</span>
          {isDirty && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />}
        </button>
      );
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Explorer
        </span>
        <button
          className="ml-auto opacity-50 hover:opacity-100"
          title="Refresh"
          onClick={() => {
            setChildren({});
            void load("", true);
          }}
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>
      {error && <p className="px-2 py-1 text-[10px] text-destructive">{error}</p>}
      <div className="min-h-0 flex-1 overflow-auto py-1">{renderDir("", 0)}</div>
    </div>
  );
}
