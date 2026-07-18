/**
 * Terminal output for the Worker.
 *
 * The Worker runs in a terminal the user watches while an agent works, so the
 * log is an interface, not a dump. Events are aligned into columns and colour
 * carries meaning: amber always means "this is waiting on you".
 *
 * Colour is disabled when stdout is not a TTY (or NO_COLOR is set) so log
 * files and `aiw service` output stay clean instead of full of escape codes.
 */

const useColor =
  process.stdout.isTTY === true && !process.env.NO_COLOR && process.env.TERM !== "dumb";

const paint = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

const c = {
  dim: paint("2"),
  bold: paint("1"),
  red: paint("38;5;203"),
  green: paint("38;5;114"),
  amber: paint("38;5;215"),
  blue: paint("38;5;75"),
  violet: paint("38;5;141"),
  cyan: paint("38;5;80"),
  grey: paint("38;5;245"),
};

function clock(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return c.dim(`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`);
}

/** Pad before colouring — escape codes would break the width calculation. */
function tag(label: string, colour: (s: string) => string): string {
  return colour(label.padEnd(9));
}

function truncate(text: string, max = 68): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function line(symbol: string, label: string, colour: (s: string) => string, detail: string): void {
  console.log(`${clock()} ${colour(symbol)} ${tag(label, colour)} ${detail}`);
}

export const log = {
  /** Startup banner: the few facts needed to connect to this Worker. */
  banner(info: {
    version: number;
    workerId: string;
    agents: string;
    keepAwake: string;
    url: string;
    approvalUrl: string;
    pairingCode: string;
  }): void {
    const rule = c.dim("─".repeat(52));
    console.log("");
    console.log(`  ${c.green("◆")} ${c.bold("ai workspace")} ${c.dim(`worker · protocol v${info.version}`)}`);
    console.log(`  ${rule}`);
    console.log(`  ${c.grey("machine ")} ${info.workerId}   ${c.grey("agents")} ${info.agents}`);
    console.log(`  ${c.grey("listening")} ${c.cyan(info.url)}`);
    console.log(`  ${c.grey("approvals")} ${c.dim(info.approvalUrl)}`);
    console.log(`  ${c.grey("keepawake")} ${c.dim(info.keepAwake)}`);
    console.log("");
    console.log(`  ${c.grey("pair with")} ${c.bold(c.amber(info.pairingCode))}`);
    console.log(`  ${rule}`);
    console.log("");
  },

  client(event: "connected" | "authed" | "gone", detail: string): void {
    if (event === "authed") return line("✓", "client", c.green, detail);
    if (event === "gone") return line("○", "client", c.grey, c.dim(detail));
    line("◇", "client", c.dim, c.dim(detail));
  },

  workspace(event: "opened" | "closed", path: string): void {
    line(event === "opened" ? "▸" : "▪", "workspace", c.blue, event === "opened" ? path : c.dim(path));
  },

  chat(where: string, text: string): void {
    line("»", "chat", c.violet, `${c.dim(where)}  ${truncate(text)}`);
  },

  command(where: string, command: string): void {
    line("$", "command", c.cyan, `${c.dim(where)}  ${truncate(command)}`);
  },

  /** Amber, and loud: nothing proceeds until the user answers. */
  approval(kind: string, detail: string, fromAgent: boolean): void {
    line(
      "▲",
      "approval",
      c.amber,
      `${c.bold(c.amber(kind))} ${c.dim(fromAgent ? "(agent)" : "(you)")}  ${truncate(detail, 52)}`,
    );
  },

  resolved(approved: boolean, kind: string): void {
    line(
      approved ? "✓" : "✕",
      approved ? "approved" : "rejected",
      approved ? c.green : c.red,
      c.dim(kind),
    );
  },

  terminal(event: "started" | "closed", id: string): void {
    line(event === "started" ? "▶" : "▪", "terminal", c.grey, c.dim(id));
  },

  preview(count: number): void {
    line("◉", "preview", c.blue, `${count} dev server${count === 1 ? "" : "s"}`);
  },

  keepawake(held: boolean, policy: string): void {
    line(held ? "☀" : "☾", "keepawake", c.grey, c.dim(held ? `holding (${policy})` : "released"));
  },

  relay(detail: string): void {
    line("◈", "relay", c.violet, detail);
  },

  info(detail: string): void {
    line("·", "info", c.grey, c.dim(detail));
  },

  warn(detail: string): void {
    line("!", "warn", c.amber, detail);
  },

  error(detail: string): void {
    line("✕", "error", c.red, detail);
  },

  shutdown(): void {
    console.log("");
    console.log(`  ${c.grey("◆ shutting down")}`);
  },
};
