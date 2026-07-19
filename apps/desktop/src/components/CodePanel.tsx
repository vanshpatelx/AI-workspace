import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { WorkersApi } from "../lib/useWorkers.js";
import { FileTree } from "./FileTree.js";
import type { OpenFile } from "./EditorPanel.js";

// Monaco is large, so it stays out of the initial bundle and loads when this
// pane is first opened.
const EditorPanel = lazy(() =>
  import("./EditorPanel.js").then((m) => ({ default: m.EditorPanel })),
);

const MIN_WIDTH = 140;
const MAX_WIDTH = 520;
const STORE_KEY = "aiw.explorerWidth";

/**
 * The explorer and the editor side by side, as an editor is normally arranged.
 *
 * They used to be separate tabs, which meant opening a file hid the tree that
 * found it — you could look at the repo or look at a file, never both. Putting
 * them in one pane costs a divider and makes the whole thing usable: the tree
 * stays put, files open into tabs beside it, and unsaved work is visible in
 * both places at once.
 */
export function CodePanel({
  url,
  workspaceId,
  fs,
  connected,
  files,
  activePath,
  onOpenPath,
  onSelect,
  onClose,
  onChange,
  onSaved,
}: {
  url: string;
  workspaceId: string;
  fs: WorkersApi["fs"];
  connected: boolean;
  files: OpenFile[];
  activePath: string | null;
  /** Fetch a path and open it as a tab; may reject if it cannot be read. */
  onOpenPath: (path: string) => Promise<void>;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onChange: (path: string, draft: string) => void;
  onSaved: (path: string, content: string) => void;
}) {
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(STORE_KEY));
    return Number.isFinite(stored) && stored >= MIN_WIDTH ? stored : 220;
  });
  const dragging = useRef(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(STORE_KEY, String(width));
  }, [width]);

  // Listeners live on the window, not the divider: a fast drag outruns the
  // 4px handle and the resize would stop dead the moment the pointer left it.
  useEffect(() => {
    const move = (event: MouseEvent) => {
      if (!dragging.current || !container.current) return;
      const left = container.current.getBoundingClientRect().left;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, event.clientX - left)));
    };
    const up = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  const startDrag = useCallback(() => {
    dragging.current = true;
    // Held for the whole drag so the cursor does not flicker back to a caret
    // when the pointer crosses the editor, and so nothing selects as it moves.
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const [openError, setOpenError] = useState<string | null>(null);

  // Unreadable files are common enough — a socket, a permission-denied path —
  // that a click which silently does nothing would read as the tree being broken.
  const openFile = useCallback(
    async (path: string) => {
      setOpenError(null);
      try {
        await onOpenPath(path);
      } catch (err) {
        setOpenError(`${path}: ${(err as Error).message}`);
      }
    },
    [onOpenPath],
  );

  const dirtyPaths = files
    .filter((f) => !f.media && f.draft !== f.saved)
    .map((f) => f.path);

  if (!connected) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Connect to a workstation to browse its files.
      </div>
    );
  }

  return (
    <div ref={container} className="flex h-full min-h-0">
      <div style={{ width }} className="min-w-0 shrink-0 border-r">
        <FileTree
          url={url}
          workspaceId={workspaceId}
          fs={fs}
          connected={connected}
          activePath={activePath}
          dirtyPaths={dirtyPaths}
          onOpenFile={openFile}
        />
      </div>

      <div
        onMouseDown={startDrag}
        className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-primary/40"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize explorer"
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {openError && (
          <div className="flex items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs">
            <span className="min-w-0 flex-1 truncate">{openError}</span>
            <button className="opacity-60 hover:opacity-100" onClick={() => setOpenError(null)}>
              dismiss
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> loading editor…
            </div>
          }
        >
          <EditorPanel
            url={url}
            workspaceId={workspaceId}
            fs={fs}
            connected={connected}
            files={files}
            activePath={activePath}
            onSelect={onSelect}
            onClose={onClose}
            onChange={onChange}
            onSaved={onSaved}
          />
        </Suspense>
        </div>
      </div>
    </div>
  );
}
