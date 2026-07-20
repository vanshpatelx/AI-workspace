import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, AlertCircle, RefreshCw, Download } from "lucide-react";
import type { WorkersApi, VSCodeProgress } from "../lib/useWorkers.js";

interface Props {
  url: string;
  /** Absolute path of the workspace, opened as VS Code's folder. */
  workspacePath: string;
  vscode: WorkersApi["vscode"];
  connected: boolean;
}

/** Human phase text; download also carries a percent. */
function progressText(p: VSCodeProgress): string {
  if (p.phase === "downloading") {
    return p.percent != null
      ? `Downloading VS Code — ${p.percent}% (first run only, ~180MB)`
      : "Downloading VS Code (first run only, ~180MB)";
  }
  if (p.phase === "extracting") return "Unpacking VS Code…";
  return "Starting VS Code…";
}

/**
 * The full VS Code workbench, running on the Worker and framed here.
 *
 * The lightweight Monaco panel this replaces was a smart text box; this is the
 * whole editor — extensions, language servers, an integrated terminal,
 * debugging — served by code-server on the Worker and reached through the same
 * pairing-gated proxy the previews use. The trade is that it must be started
 * (and, once, downloaded) rather than being instantly there.
 */
export function VSCodePanel({ url, workspacePath, vscode, connected }: Props) {
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [progress, setProgress] = useState<VSCodeProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // Guards against double-starts from React strict-mode's paired effect run.
  const started = useRef(false);

  const start = useCallback(async () => {
    if (!connected) return;
    setStarting(true);
    setError(null);
    setProgress(null);
    try {
      const ready = await vscode.start(url, setProgress);
      if (ready.error) {
        setError(ready.error);
        return;
      }
      // The folder tells VS Code which project to open; the token authenticates
      // the first request, after which the proxy's cookie carries the rest.
      const src =
        `${ready.base}/?__aiw=${encodeURIComponent(ready.token)}` +
        `&folder=${encodeURIComponent(workspacePath)}`;
      setFrameSrc(src);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStarting(false);
      setProgress(null);
    }
  }, [connected, url, vscode, workspacePath]);

  useEffect(() => {
    if (connected && !started.current) {
      started.current = true;
      void start();
    }
  }, [connected, start]);

  if (!connected) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Connect to a workstation to open VS Code.
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="h-6 w-6 text-destructive" />
        <p className="max-w-md text-sm text-muted-foreground">{error}</p>
        <button
          onClick={() => {
            started.current = false;
            void start();
          }}
          className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Try again
        </button>
      </div>
    );
  }

  if (!frameSrc || starting) {
    const downloading = progress?.phase === "downloading";
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        {downloading ? (
          <Download className="h-7 w-7 text-cyan-400" />
        ) : (
          <Loader2 className="h-7 w-7 animate-spin text-cyan-400" />
        )}
        <p className="text-sm">{progress ? progressText(progress) : "Starting VS Code…"}</p>
        {downloading && progress?.percent != null && (
          <div className="h-1.5 w-64 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-cyan-400 transition-all"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        )}
        <p className="max-w-sm text-[11px] text-muted-foreground">
          Full VS Code runs on the workstation — extensions, IntelliSense, a real
          terminal and debugging. It downloads once, then starts in seconds.
        </p>
      </div>
    );
  }

  return (
    <iframe
      key={frameSrc}
      src={frameSrc}
      title="VS Code"
      className="h-full w-full border-0 bg-[#1e1e1e]"
      // The workbench needs clipboard and same-origin storage to function.
      allow="clipboard-read; clipboard-write"
      data-testid="vscode-frame"
    />
  );
}
