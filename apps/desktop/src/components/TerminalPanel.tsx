import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { WorkersApi } from "../lib/useWorkers.js";

interface Props {
  url: string;
  terminalId: string;
  terminal: WorkersApi["terminal"];
  connected: boolean;
}

/**
 * Live PTY view.
 *
 * xterm owns its own DOM and buffer, so terminal bytes never pass through
 * React state — the socket writes straight into the emulator. React only
 * mounts/unmounts it and forwards resizes.
 */
export function TerminalPanel({ url, terminalId, terminal, connected }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current || !connected) return;

    const term = new XTerm({
      fontSize: 12,
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      cursorBlink: true,
      convertEol: false,
      theme: {
        background: "#0a0a0b",
        foreground: "#e5e5e7",
        cursor: "#e5e5e7",
        selectionBackground: "#33333a",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();

    // Worker -> terminal
    const unsubscribe = terminal.subscribe((id, data) => {
      if (id === terminalId) term.write(data);
    });

    // Terminal -> worker
    const onData = term.onData((data) => terminal.input(url, terminalId, data));

    terminal.start(url, terminalId, term.cols, term.rows);

    const onResize = () => {
      fit.fit();
      terminal.resize(url, terminalId, term.cols, term.rows);
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      onData.dispose();
      unsubscribe();
      terminal.close(url, terminalId);
      term.dispose();
    };
  }, [url, terminalId, terminal, connected]);

  if (!connected) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Connect to a workstation to open a terminal.
      </div>
    );
  }

  return <div ref={hostRef} className="h-full w-full overflow-hidden" data-testid="terminal" />;
}
