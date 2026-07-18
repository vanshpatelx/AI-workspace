#!/usr/bin/env node
import {
  configExists,
  configPath,
  loadConfig,
  type KeepAwakePolicy,
  type TransportKind,
} from "./config.js";
import { agentLabel } from "./agents.js";
import { runInit, type InitOptions } from "./init.js";
import { startWorker } from "./server.js";
import { serveUi, uiDir, uiDirExists } from "./ui.js";
import { installService, serviceStatus, uninstallService } from "./service.js";
import { log } from "./log.js";

/** Parse `--flag value` and boolean `--flag` pairs from args. */
function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg || !arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

function initOptionsFromFlags(flags: Record<string, string | boolean>): InitOptions {
  const opts: InitOptions = {};
  if (flags.yes === true || flags.y === true) opts.yes = true;
  if (typeof flags.port === "string") opts.port = Number(flags.port);
  if (typeof flags.transport === "string") opts.transport = flags.transport as TransportKind;
  if (typeof flags["keep-awake"] === "string") opts.keepAwake = flags["keep-awake"] as KeepAwakePolicy;
  if (typeof flags.relay === "string") opts.relayUrl = flags.relay;
  return opts;
}

/**
 * `aiw` command-line entrypoint.
 *
 *   aiw worker init     interactive setup wizard
 *   aiw worker start     launch the transport server
 *   aiw worker status    show config + whether it's set up
 *   aiw help
 */

const HELP = `ai-workspace CLI

Usage:
  aiw worker init      Configure this machine as a Worker
                         --yes                 unattended (defaults + detected agents)
                         --port <n>            transport port (default 4501)
                         --transport <kind>    tailscale|wireguard|local|ssh
                         --keep-awake <policy> while-active|always|off
  aiw worker start     Start the Worker (transport server + keep-awake)
  aiw worker status    Show this Worker's configuration
  aiw ui [--port n]    Serve the Desktop UI (default http://127.0.0.1:5180)

  aiw service install    Run the Worker at login and restart it if it exits
  aiw service uninstall  Remove the background service
  aiw service status     Show whether the service is installed and running

  aiw help             Show this help

Docs: https://github.com/vanshpatelx/AI-workspace`;

async function cmdStart(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    console.error("No Worker config found. Run `aiw worker init` first.");
    process.exitCode = 1;
    return;
  }
  const worker = startWorker(config);

  let shuttingDown = false;
  const shutdown = () => {
    // A second Ctrl+C means "I'm done waiting" — exit immediately.
    if (shuttingDown) {
      log.warn("force quit");
      process.exit(1);
    }
    shuttingDown = true;
    log.shutdown();

    // Never hang: if graceful cleanup stalls (a stuck PTY, a socket that
    // won't drain), exit anyway rather than leaving the user pressing Ctrl+C.
    const force = setTimeout(() => {
      log.warn("cleanup timed out, exiting");
      process.exit(1);
    }, 3000);
    force.unref();

    void worker
      .stop()
      .catch(() => {})
      .then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function cmdStatus(): void {
  if (!configExists()) {
    console.log("Worker: not configured. Run `aiw worker init`.");
    return;
  }
  const config = loadConfig();
  if (!config) {
    console.log(`Worker: config at ${configPath()} is unreadable/corrupt. Re-run \`aiw worker init\`.`);
    return;
  }
  console.log("Worker: configured");
  console.log(`  config:      ${configPath()}`);
  console.log(`  id:          ${config.workerId}`);
  console.log(`  port:        ${config.port}`);
  console.log(`  transport:   ${config.transport}`);
  console.log(`  keepAwake:   ${config.keepAwake}`);
  console.log(`  agents:      ${config.agents.map(agentLabel).join(", ") || "none"}`);
  console.log(`  pairing:     ${config.pairingCode}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const [group, sub] = argv;
  const flags = parseFlags(argv.slice(2));

  if (group === "help" || group === "--help" || group === "-h" || !group) {
    console.log(HELP);
    return;
  }

  if (group === "ui") {
    if (!uiDirExists()) {
      console.error(`Desktop UI build not found at ${uiDir()}`);
      console.error("Build it first:  pnpm --filter @ai-workspace/desktop build");
      process.exitCode = 1;
      return;
    }
    const uiFlags = parseFlags(argv.slice(1));
    serveUi(typeof uiFlags.port === "string" ? Number(uiFlags.port) : 5180);
    return;
  }

  if (group === "service") {
    try {
      switch (sub) {
        case "install": {
          if (!configExists()) {
            console.error("No Worker config found. Run `aiw worker init` first.");
            process.exitCode = 1;
            return;
          }
          const path = await installService(process.cwd());
          console.log("Worker service installed and started.");
          console.log(`  plist:  ${path}`);
          console.log("  It now starts at login and restarts if it exits.");
          console.log("  Check it with:  aiw service status");
          return;
        }
        case "uninstall":
          await uninstallService();
          console.log("Worker service stopped and removed.");
          return;
        case "status": {
          const status = await serviceStatus();
          console.log(`Service: ${status.installed ? "installed" : "not installed"}`);
          console.log(`  running: ${status.running ? `yes (pid ${status.pid})` : "no"}`);
          console.log(`  plist:   ${status.plist}`);
          console.log(`  logs:    ${status.logs}`);
          return;
        }
        default:
          console.error(`Unknown service command: ${sub ?? "(none)"}\n`);
          console.log(HELP);
          process.exitCode = 1;
          return;
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
      return;
    }
  }

  if (group === "worker") {
    switch (sub) {
      case "init":
        await runInit(initOptionsFromFlags(flags));
        return;
      case "start":
        await cmdStart();
        return;
      case "status":
        cmdStatus();
        return;
      default:
        console.error(`Unknown worker command: ${sub ?? "(none)"}\n`);
        console.log(HELP);
        process.exitCode = 1;
        return;
    }
  }

  console.error(`Unknown command: ${group}\n`);
  console.log(HELP);
  process.exitCode = 1;
}

void main();
