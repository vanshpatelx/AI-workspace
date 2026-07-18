import { useCallback, useEffect, useState } from "react";
import { Globe, RefreshCw, ExternalLink, AlertCircle } from "lucide-react";
import type { PreviewServer } from "@ai-workspace/protocol";
import type { WorkersApi } from "../lib/useWorkers.js";
import { Button } from "./ui/button.js";
import { Badge } from "./ui/badge.js";

interface Props {
  url: string;
  preview: WorkersApi["preview"];
  connected: boolean;
}

/**
 * Detects dev servers running on the Worker and frames them.
 *
 * The iframe points at the Worker's proxy rather than the dev server directly,
 * so a preview still renders when the Worker is a different machine (over
 * Tailscale/WireGuard) and when the dev server sets X-Frame-Options.
 */
export function PreviewPanel({ url, preview, connected }: Props) {
  const [servers, setServers] = useState<PreviewServer[]>([]);
  const [proxyBase, setProxyBase] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [nonce, setNonce] = useState(0);

  const scan = useCallback(async () => {
    if (!connected) return;
    setScanning(true);
    setError(null);
    try {
      const result = await preview.scan(url);
      setServers(result.servers);
      setProxyBase(result.proxyBase);
      setSelected((prev) => prev ?? result.servers[0]?.port ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setScanning(false);
    }
  }, [connected, preview, url]);

  useEffect(() => {
    void scan();
  }, [scan]);

  if (!connected) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Connect to a workstation to detect dev servers.
      </div>
    );
  }

  const frameSrc = selected ? `${proxyBase}/${selected}/?_=${nonce}` : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2">
        {servers.map((s) => (
          <button
            key={s.port}
            onClick={() => setSelected(s.port)}
            className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${
              selected === s.port ? "border-primary/60 bg-accent" : "hover:bg-accent/50"
            }`}
            title={s.title ?? s.process}
          >
            <Globe className="h-3 w-3" />
            <span className="font-mono">:{s.port}</span>
            {s.framework && (
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                {s.framework}
              </Badge>
            )}
          </button>
        ))}

        {servers.length === 0 && !scanning && (
          <span className="text-xs text-muted-foreground">No dev servers detected.</span>
        )}
        {scanning && <span className="text-xs text-muted-foreground">scanning…</span>}

        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={scan} title="Rescan">
            <RefreshCw className={`h-3.5 w-3.5 ${scanning ? "animate-spin" : ""}`} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setNonce((n) => n + 1)}
            title="Reload preview"
            disabled={!selected}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </div>
      )}

      <div className="min-h-0 flex-1 bg-white">
        {frameSrc ? (
          <iframe
            key={frameSrc}
            src={frameSrc}
            title={`preview-${selected}`}
            className="h-full w-full border-0"
            data-testid="preview-frame"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-background text-sm text-muted-foreground">
            Start a dev server on this workstation, then rescan.
          </div>
        )}
      </div>
    </div>
  );
}
