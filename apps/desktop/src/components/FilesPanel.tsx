import { useCallback, useEffect, useState } from "react";
import { Folder, FileText, ChevronRight, Home, AlertCircle } from "lucide-react";
import type { FileEntry } from "@ai-workspace/protocol";
import type { FilePreview, WorkersApi } from "../lib/useWorkers.js";
import { Button } from "./ui/button.js";

interface Props {
  url: string;
  /** Browsing is rooted at this workspace's directory. */
  workspaceId: string;
  fs: WorkersApi["fs"];
  connected: boolean;
}

/**
 * Repo browser + media preview.
 *
 * Directories navigate; files are fetched and rendered inline — text as code,
 * images/video/audio/PDF from a data URI — so nothing has to be downloaded.
 */
export function FilesPanel({ url, workspaceId, fs, connected }: Props) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const openDir = useCallback(
    async (next: string) => {
      if (!connected) return;
      setLoading(true);
      setError(null);
      setPreview(null);
      try {
        const listing = await fs.list(url, workspaceId, next);
        setPath(listing.path);
        setEntries(listing.entries);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [connected, fs, url, workspaceId],
  );

  useEffect(() => {
    void openDir("");
  }, [openDir]);

  const openFile = async (name: string) => {
    setLoading(true);
    setError(null);
    try {
      setPreview(await fs.read(url, workspaceId, join(path, name)));
    } catch (err) {
      setError((err as Error).message);
      setPreview(null);
    } finally {
      setLoading(false);
    }
  };

  if (!connected) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Connect to a workstation to browse files.
      </div>
    );
  }

  const crumbs = path ? path.split("/") : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Breadcrumbs */}
      <div className="flex flex-wrap items-center gap-1 border-b px-3 py-2 text-xs">
        <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => openDir("")}>
          <Home className="h-3 w-3" />
        </Button>
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
            <button
              className="rounded px-1 hover:bg-accent"
              onClick={() => openDir(crumbs.slice(0, i + 1).join("/"))}
            >
              {c}
            </button>
          </span>
        ))}
        {loading && <span className="ml-auto text-muted-foreground">loading…</span>}
      </div>

      {error && (
        <div className="flex items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(180px,240px)_1fr]">
        {/* Listing */}
        <div className="min-h-0 overflow-y-auto border-r">
          {path && (
            <Row
              icon={<Folder className="h-3.5 w-3.5" />}
              label=".."
              onClick={() => openDir(parentOf(path))}
            />
          )}
          {entries.map((e) => (
            <Row
              key={e.name}
              icon={
                e.kind === "dir" ? (
                  <Folder className="h-3.5 w-3.5 text-sky-400" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )
              }
              label={e.name}
              hint={e.kind === "file" ? formatSize(e.size) : undefined}
              onClick={() => (e.kind === "dir" ? openDir(join(path, e.name)) : openFile(e.name))}
            />
          ))}
          {entries.length === 0 && !loading && (
            <p className="p-3 text-xs text-muted-foreground">empty directory</p>
          )}
        </div>

        {/* Preview */}
        <div className="min-h-0 overflow-auto">
          {preview ? (
            <Preview preview={preview} />
          ) : (
            <p className="p-4 text-center text-sm text-muted-foreground">
              Select a file to preview it.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Preview({ preview }: { preview: FilePreview }) {
  const { mime, base64, content, path } = preview;
  const dataUri = `data:${mime};base64,${content}`;

  if (base64 && mime.startsWith("image/")) {
    return (
      <div className="p-4">
        <PreviewTitle path={path} />
        <img src={dataUri} alt={path} className="max-h-[60vh] max-w-full rounded border" />
      </div>
    );
  }
  if (base64 && mime.startsWith("video/")) {
    return (
      <div className="p-4">
        <PreviewTitle path={path} />
        <video src={dataUri} controls className="max-h-[60vh] max-w-full rounded border" />
      </div>
    );
  }
  if (base64 && mime.startsWith("audio/")) {
    return (
      <div className="p-4">
        <PreviewTitle path={path} />
        <audio src={dataUri} controls className="w-full" />
      </div>
    );
  }
  if (base64 && mime === "application/pdf") {
    return (
      <div className="flex h-full flex-col p-4">
        <PreviewTitle path={path} />
        <iframe src={dataUri} title={path} className="min-h-0 flex-1 rounded border" />
      </div>
    );
  }

  return (
    <div className="p-4">
      <PreviewTitle path={path} />
      <pre className="overflow-x-auto whitespace-pre-wrap rounded border bg-muted/40 p-3 text-[11px] leading-relaxed">
        {content}
      </pre>
    </div>
  );
}

function PreviewTitle({ path }: { path: string }) {
  return <div className="mb-2 truncate font-mono text-xs text-muted-foreground">{path}</div>;
}

function Row({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent"
    >
      {icon}
      <span className="truncate">{label}</span>
      {hint && <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{hint}</span>}
    </button>
  );
}

function join(base: string, name: string): string {
  return base ? `${base}/${name}` : name;
}

function parentOf(p: string): string {
  const parts = p.split("/");
  parts.pop();
  return parts.join("/");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
