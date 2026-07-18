import { spawn, type IPty } from "node-pty";
import { env, platform } from "node:process";

export interface TerminalHandlers {
  onData(terminalId: string, data: string): void;
  onExit(terminalId: string, code: number | null): void;
}

/** The user's login shell, falling back sensibly per platform. */
function defaultShell(): string {
  if (platform === "win32") return env.COMSPEC ?? "powershell.exe";
  return env.SHELL ?? "/bin/zsh";
}

/**
 * Owns the PTY processes backing interactive terminals.
 *
 * Note: a terminal is the *user* driving a real shell, so it deliberately
 * bypasses the Approval Center — that gate exists for actions the agent (or a
 * remote command) wants to take, not for keystrokes the operator types.
 * Reaching a terminal at all already requires pairing-code authentication.
 */
export class TerminalManager {
  private readonly ptys = new Map<string, IPty>();

  constructor(
    private cwd: string,
    private handlers: TerminalHandlers,
  ) {}

  /** Returns an error message if the PTY could not be started. */
  start(terminalId: string, cols: number, rows: number): string | null {
    if (this.ptys.has(terminalId)) return null;

    // node-pty only accepts string values; drop any undefined entries.
    const cleanEnv: Record<string, string> = { TERM: "xterm-256color" };
    for (const [k, v] of Object.entries(env)) if (typeof v === "string") cleanEnv[k] = v;

    let pty: IPty;
    try {
      pty = spawn(defaultShell(), [], {
        name: "xterm-color",
        cols: Math.max(cols, 2),
        rows: Math.max(rows, 2),
        cwd: this.cwd,
        env: cleanEnv,
      });
    } catch (err) {
      // A shell that won't spawn must not take the Worker down with it.
      return `failed to start terminal: ${(err as Error).message}`;
    }

    this.ptys.set(terminalId, pty);
    pty.onData((data) => this.handlers.onData(terminalId, data));
    pty.onExit(({ exitCode }) => {
      this.ptys.delete(terminalId);
      this.handlers.onExit(terminalId, exitCode);
    });
    return null;
  }

  write(terminalId: string, data: string): void {
    this.ptys.get(terminalId)?.write(data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    try {
      this.ptys.get(terminalId)?.resize(Math.max(cols, 2), Math.max(rows, 2));
    } catch {
      // Resizing a PTY that just exited is harmless.
    }
  }

  close(terminalId: string): void {
    const pty = this.ptys.get(terminalId);
    if (!pty) return;
    this.ptys.delete(terminalId);
    pty.kill();
  }

  /** Kill every PTY (Worker shutdown, or a client disconnecting). */
  closeAll(): void {
    for (const id of [...this.ptys.keys()]) this.close(id);
  }

  get count(): number {
    return this.ptys.size;
  }
}
