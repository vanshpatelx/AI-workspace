import { useCallback, useEffect, useRef, useState } from "react";
import {
  Smartphone,
  RefreshCw,
  AlertCircle,
  Hand,
  Eye,
  House,
  ArrowLeft,
  CornerDownLeft,
  Delete,
} from "lucide-react";
import type { MirroredDevice } from "@ai-workspace/protocol";
import type { WorkersApi } from "../lib/useWorkers.js";
import { Button } from "./ui/button.js";
import { Badge } from "./ui/badge.js";

interface Props {
  url: string;
  devices: WorkersApi["devices"];
  connected: boolean;
}

/** Hardware keys worth a button, and which platforms actually have them. */
const KEYS = [
  { key: "home" as const, Icon: House, label: "Home", both: true },
  { key: "back" as const, Icon: ArrowLeft, label: "Back", both: false },
  { key: "enter" as const, Icon: CornerDownLeft, label: "Enter", both: true },
  { key: "backspace" as const, Icon: Delete, label: "Backspace", both: true },
];

/**
 * Mirrors a running simulator and drives it.
 *
 * A dev server can be framed directly because it speaks HTTP; a simulator has no
 * such surface, so the Worker captures frames and this renders them as a live
 * <img> fed by a multipart stream — which the browser paints natively, without a
 * decoding loop in JavaScript.
 *
 * Clicks are sent as a fraction of the image rather than pixels: the frame is
 * displayed at whatever size the panel is, and only the Worker knows the device's
 * real geometry (and, on iOS, that taps are in points while frames are in pixels).
 */
export function DevicePanel({ url, devices, connected }: Props) {
  const [list, setList] = useState<MirroredDevice[]>([]);
  const [streamBase, setStreamBase] = useState("");
  const [token, setToken] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [nonce, setNonce] = useState(0);
  /** Where the last tap landed, so there is feedback before the frame catches up. */
  const [ripple, setRipple] = useState<{ x: number; y: number; at: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const scan = useCallback(async () => {
    if (!connected) return;
    setScanning(true);
    setError(null);
    try {
      const result = await devices.scan(url);
      setList(result.devices);
      setStreamBase(result.streamBase);
      setToken(result.token);
      setSelectedId((prev) =>
        prev && result.devices.some((d) => d.id === prev) ? prev : (result.devices[0]?.id ?? null),
      );
      // Force the <img> to reconnect: the old stream is bound to a device that
      // may no longer exist, and a dead multipart response never errors out.
      setNonce((n) => n + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setScanning(false);
    }
  }, [connected, devices, url]);

  useEffect(() => {
    void scan();
  }, [scan]);

  const selected = list.find((d) => d.id === selectedId) ?? null;

  const onTap = async (event: React.MouseEvent<HTMLImageElement>) => {
    if (!selected || !imgRef.current) return;
    const box = imgRef.current.getBoundingClientRect();
    const fx = (event.clientX - box.left) / box.width;
    const fy = (event.clientY - box.top) / box.height;
    setRipple({ x: event.clientX - box.left, y: event.clientY - box.top, at: Date.now() });
    const failure = await devices.tap(url, selected.id, fx, fy);
    if (failure) setError(failure);
  };

  // Typing goes to the device rather than the page, so the panel takes focus and
  // forwards keystrokes. Printable characters become text; the rest become keys.
  const onKeyDown = async (event: React.KeyboardEvent) => {
    if (!selected?.canInput) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    const failure =
      event.key.length === 1
        ? await devices.text(url, selected.id, event.key)
        : event.key === "Enter"
          ? await devices.key(url, selected.id, "enter")
          : event.key === "Backspace"
            ? await devices.key(url, selected.id, "backspace")
            : null;
    if (failure) setError(failure);
  };

  const pressKey = async (key: "home" | "back" | "enter" | "backspace") => {
    if (!selected) return;
    const failure = await devices.key(url, selected.id, key);
    if (failure) setError(failure);
  };

  useEffect(() => {
    if (!ripple) return;
    const timer = setTimeout(() => setRipple(null), 400);
    return () => clearTimeout(timer);
  }, [ripple]);

  if (!connected) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Connect to a workstation to mirror its simulators.
      </div>
    );
  }

  const streamSrc =
    selected && streamBase
      ? `${streamBase}/${encodeURIComponent(selected.id)}/stream?__aiw=${encodeURIComponent(token)}&_=${nonce}`
      : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2">
        {list.map((device) => (
          <button
            key={device.id}
            onClick={() => setSelectedId(device.id)}
            className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${
              selectedId === device.id ? "border-primary/60 bg-accent" : "hover:bg-accent/50"
            }`}
            title={`${device.name} · ${device.runtime}`}
          >
            <Smartphone className="h-3 w-3" />
            <span>{device.name}</span>
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
              {device.runtime}
            </Badge>
            {/* Whether taps work is the first thing worth knowing about a device. */}
            {device.canInput ? (
              <Hand className="h-3 w-3 text-emerald-400" />
            ) : (
              <Eye className="h-3 w-3 text-amber-400" />
            )}
          </button>
        ))}

        {list.length === 0 && !scanning && (
          <span className="text-xs text-muted-foreground">No simulators running.</span>
        )}
        {scanning && <span className="text-xs text-muted-foreground">scanning…</span>}

        <div className="ml-auto flex items-center gap-1">
          {selected?.canInput &&
            KEYS.filter((k) => k.both || selected.platform === "android").map(
              ({ key, Icon, label }) => (
                <Button
                  key={key}
                  size="sm"
                  variant="ghost"
                  onClick={() => pressKey(key)}
                  title={label}
                >
                  <Icon className="h-3.5 w-3.5" />
                </Button>
              ),
            )}
          <Button size="sm" variant="ghost" onClick={scan} title="Rescan">
            <RefreshCw className={`h-3.5 w-3.5 ${scanning ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* View-only is a normal state, not a failure — say what enables tapping. */}
      {selected && !selected.canInput && selected.inputHint && (
        <div className="flex items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
          <Eye className="h-3.5 w-3.5 shrink-0 text-amber-400" />
          <span>View only.</span>
          <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[10px]">
            {selected.inputHint}
          </code>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
          <button className="ml-auto opacity-60 hover:opacity-100" onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      )}

      <div
        className="flex min-h-0 flex-1 items-center justify-center bg-black/40 p-4 outline-none"
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        {streamSrc ? (
          <div className="relative h-full">
            <img
              ref={imgRef}
              key={streamSrc}
              src={streamSrc}
              alt={selected?.name ?? "device"}
              onClick={onTap}
              onError={() => setError("Frame stream ended — rescan to reconnect.")}
              className={`h-full rounded-[2rem] border-4 border-neutral-800 object-contain shadow-2xl ${
                selected?.canInput ? "cursor-pointer" : "cursor-default"
              }`}
              data-testid="device-frame"
            />
            {ripple && (
              <span
                className="pointer-events-none absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full border-2 border-primary"
                style={{ left: ripple.x, top: ripple.y }}
              />
            )}
          </div>
        ) : (
          <div className="max-w-sm text-center text-sm text-muted-foreground">
            <Smartphone className="mx-auto mb-2 h-8 w-8 opacity-40" />
            Boot an iOS Simulator or start an Android emulator on this workstation, then rescan.
          </div>
        )}
      </div>
    </div>
  );
}
