# AI-workspace

A local-first desktop application for managing AI-powered development environments running across one or more machines.

Instead of remotely controlling computers, you reconnect to persistent AI workspaces containing active coding agents, local development environments, browser sessions, previews, and project context.

**Privacy-first.** By default, no project data, source code, prompts, files, or AI conversations are uploaded to external servers.

## Core Principles

- Local-first
- Privacy-first
- Zero stored customer data
- Persistent AI workspaces
- Multi-machine support
- AI-native interface
- Works with any AI coding agent

## Architecture

- **Worker** — installed on every Mac/workstation. Launches AI agents, tracks sessions, monitors terminal output, exposes local resources, manages previews, streams updates, handles approvals.
- **Desktop App** — the control center. View workstations, continue conversations, monitor progress, browse files, preview sites, approve actions, open terminals.
- **Connectivity** — direct + encrypted (Tailscale, WireGuard, local network, SSH tunnel). Optional stateless relay for remote access without VPNs.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/vanshpatelx/AI-workspace/main/install.sh | bash
```

Then:

```bash
aiw worker init      # configure this machine (transport, keep-awake, agents)
aiw worker start     # run the Worker
aiw ui               # serve the Desktop UI at http://127.0.0.1:5180
```

Pair the UI with the code from `aiw worker status`. Requires Node 20+ and git.

To keep the Worker running across logins and reboots (macOS):

```bash
aiw service install     # starts at login, restarts if it exits
aiw service status
aiw service uninstall
```

### Desktop app

Download the `.dmg` from [Releases](https://github.com/vanshpatelx/AI-workspace/releases)
and drag it to Applications. The build is unsigned, so on first launch
right-click the app and choose **Open**.

To build it yourself:

```bash
pnpm -r build
pnpm --filter @ai-workspace/desktop dist:mac   # -> apps/desktop/release/*.dmg
```

## Run it (dev)

```bash
pnpm install
pnpm -r build

pnpm --filter @ai-workspace/worker cli worker init --yes
pnpm --filter @ai-workspace/worker start          # terminal 1
pnpm --filter @ai-workspace/desktop dev            # terminal 2 -> localhost:5173
```

The dashboard shows the Worker, and the chat panel drives a real Claude Code
agent (if `claude` is on your PATH). Sensitive actions — the agent's own
included — are gated by the Approval Center. `VITE_WORKER_URL` overrides the
Worker address for the UI.

> Workspace packages resolve from `dist/`, so run `pnpm build:packages`
> after changing `packages/*`.

## License

See [LICENSE](LICENSE). Non-commercial use only; commercial use requires prior written permission.
