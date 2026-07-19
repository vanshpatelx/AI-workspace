import { useCallback, useEffect, useRef, useState } from "react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import { X, Save, FileText, Columns2, Loader2 } from "lucide-react";
import { languageFor } from "../lib/monaco.js";
import type { WorkersApi } from "../lib/useWorkers.js";
import { Button } from "./ui/button.js";

export interface OpenFile {
  path: string;
  /** Content on disk when the file was opened or last saved. */
  saved: string;
  /** Current buffer, which may differ. */
  draft: string;
}

/**
 * A small editor over the workspace: tabs, syntax highlighting, save, and a
 * diff against what is on disk.
 *
 * The diff is the reason this is worth having over a viewer — when an agent
 * edits a file underneath you, seeing exactly what changed matters more than
 * reading the result.
 */
export function EditorPanel({
  url,
  workspaceId,
  fs,
  connected,
  files,
  activePath,
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
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onChange: (path: string, draft: string) => void;
  onSaved: (path: string, content: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const active = files.find((f) => f.path === activePath) ?? null;
  const dirty = active ? active.draft !== active.saved : false;

  const save = useCallback(async () => {
    if (!active || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      await fs.write(url, workspaceId, active.path, active.draft);
      onSaved(active.path, active.draft);
      setShowDiff(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [active, dirty, fs, url, workspaceId, onSaved]);

  // ⌘S / Ctrl+S, because anything else feels broken in an editor.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!connected) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Connect to a workstation to edit files.
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-sm text-muted-foreground">
        <FileText className="h-5 w-5 opacity-40" />
        <span>Open a file from the tree to edit it.</span>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto border-b px-1.5 py-1">
        {files.map((file) => {
          const isDirty = file.draft !== file.saved;
          const name = file.path.split("/").pop();
          return (
            <div
              key={file.path}
              onClick={() => onSelect(file.path)}
              className={`group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs ${
                file.path === activePath ? "bg-accent" : "hover:bg-accent/50"
              }`}
              title={file.path}
            >
              <span className="max-w-[160px] truncate">{name}</span>
              {isDirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="Unsaved" />}
              <button
                className="opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(file.path);
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}

        <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">
          {dirty && (
            <Button
              size="sm"
              variant={showDiff ? "secondary" : "ghost"}
              className="h-6 px-2 text-[11px]"
              onClick={() => setShowDiff((d) => !d)}
              title="Compare with the file on disk"
            >
              <Columns2 className="h-3 w-3" /> Diff
            </Button>
          )}
          <Button
            size="sm"
            className="h-6 px-2 text-[11px]"
            disabled={!dirty || saving}
            onClick={() => void save()}
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            {dirty ? "Save" : "Saved"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {active &&
          (showDiff ? (
            <DiffEditor
              key={`diff:${active.path}`}
              keepCurrentOriginalModel
              keepCurrentModifiedModel
              original={active.saved}
              modified={active.draft}
              language={languageFor(active.path)}
              theme="aiw-dark"
              options={{
                readOnly: true,
                renderSideBySide: true,
                fontSize: 12,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
              }}
            />
          ) : (
            <Editor
              key={`edit:${active.path}`}
              path={active.path}
              defaultValue={active.saved}
              value={active.draft}
              language={languageFor(active.path)}
              theme="aiw-dark"
              onChange={(value) => onChange(active.path, value ?? "")}
              options={{
                fontSize: 12,
                fontFamily:
                  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                tabSize: 2,
                automaticLayout: true,
                padding: { top: 10 },
              }}
            />
          ))}
      </div>
    </div>
  );
}
