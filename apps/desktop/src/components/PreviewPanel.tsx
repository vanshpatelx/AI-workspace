import { useCallback, useEffect, useState } from "react";
import { Globe, RefreshCw, ExternalLink, AlertCircle, Smartphone, Copy, Check } from "lucide-react";
import type { PreviewServer } from "@ai-workspace/protocol";
import type { WorkersApi } from "../lib/useWorkers.js";
import { Button } from "./ui/button.js";
import { Badge } from "./ui/badge.js";

interface Props {
  url: string;
  preview: WorkersApi["preview"];
  connected: boolean;
}

/** One copyable line, so a host or command never has to be retyped by hand. */
function Copyable({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="flex w-full items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-left font-mono text-[11px] hover:bg-muted"
      title="Copy"
    >
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {copied ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
      ) : (
        <Copy className="h-3.5 w-3.5 shrink-0 opacity-50" />
      )}
    </button>
  );
}

/**
 * What to do with a Metro bundler, which is not something you can frame.
 *
 * Mirroring a simulator across the network was tried and removed: ten frames a
 * second cannot show the animations and gestures you go to a device to check.
 * Metro serves a bundle over plain HTTP, so the simulator can run on *this*
 * machine at full frame rate and fetch its JavaScript from the Worker instead —
 * the code and the agent stay remote, the pixels stay local.
 */
function MetroPanel({
  server,
  host,
  onReload,
}: {
  server: PreviewServer;
  host: string;
  onReload: () => Promise<void>;
}) {
  const [reloading, setReloading] = useState(false);
  const packagerHost = `${host}:${server.port}`;

  return (
    <div className="h-full overflow-y-auto bg-background p-5">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-2">
          <Smartphone className="h-5 w-5 text-cyan-400" />
          <div className="min-w-0">
            <h3 className="text-sm font-medium">Metro · React Native</h3>
            <p className="truncate text-[11px] text-muted-foreground">
              {server.projectRoot ?? `port ${server.port}`}
            </p>
          </div>
          <Button
            size="sm"
            className="ml-auto h-7 text-[11px]"
            disabled={reloading}
            onClick={async () => {
              setReloading(true);
              await onReload();
              setReloading(false);
            }}
            title="Tell Metro to reload the connected app"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${reloading ? "animate-spin" : ""}`} />
            Reload app
          </Button>
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Run the simulator on <strong className="text-foreground">this</strong> machine and point
          it at the bundler here. The app runs locally at full frame rate with real gestures, while
          the code, the agent and Metro stay on the workstation.
        </p>

        <div className="space-y-1.5">
          <p className="text-[11px] font-medium">Packager host</p>
          <Copyable text={packagerHost} />
          <p className="text-[10px] text-muted-foreground">
            In the running app: shake (or Cmd+D) → Settings → Debug server host, paste this, then
            reload.
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] font-medium">Or launch pointed at it</p>
          <Copyable text={`RCT_METRO_PORT=${server.port} npx react-native run-ios`} />
          <Copyable text={`npx expo start --dev-client --host lan`} />
        </div>

        <p className="text-[10px] leading-relaxed text-muted-foreground">
          The workstation must be reachable from here — Tailscale, WireGuard or the same LAN. That
          is the same connection this app already uses, so if you are seeing this, it works.
        </p>
      </div>
    </div>
  );
}

/**
 * Detects dev servers running on the Worker and frames them.
 *
 * The iframe points at the Worker's proxy rather than the dev server directly,
 * so a preview still renders when the Worker is a different machine (over
 * Tailscale/WireGuard) and when the dev server sets X-Frame-Options.
 */
export function PreviewPanel({ url, preview, connected }: Props) {
  // The packager address the simulator must dial is this Worker's host — the
  // same one this app connected to, not localhost, which would be *this* Mac.
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "localhost";
    }
  })();
  const [servers, setServers] = useState<PreviewServer[]>([]);
  const [proxyBase, setProxyBase] = useState("");
  const [token, setToken] = useState("");
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
      setToken(result.token);
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

  const current = servers.find((s) => s.port === selected) ?? null;

  // The proxy authenticates with the pairing code and replies with a cookie,
  // so the framed page's own asset requests stay authorised. Metro is excluded:
  // it serves a bundle, not a page, so there is nothing to frame.
  const frameSrc =
    selected && current?.kind !== "metro"
      ? `${proxyBase}/${selected}/?__aiw=${encodeURIComponent(token)}&_=${nonce}`
      : null;

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
        {current?.kind === "metro" ? (
          <MetroPanel
            server={current}
            host={host}
            onReload={async () => {
              const failure = await preview.reload(url, current.port);
              setError(failure);
            }}
          />
        ) : frameSrc ? (
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
