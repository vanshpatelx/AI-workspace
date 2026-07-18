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

## Run it (dev)

```bash
pnpm install

# 1. Configure this machine as a Worker (once)
pnpm --filter @ai-workspace/worker cli worker init --yes

# 2. Start the Worker (transport server + keep-awake + agents)
pnpm --filter @ai-workspace/worker start

# 3. In another terminal, launch the Desktop UI
pnpm --filter @ai-workspace/desktop dev
# open http://localhost:5173
```

The Desktop dashboard shows the Worker, and the chat panel drives a real
Claude Code agent (if `claude` is on your PATH). `VITE_WORKER_URL` overrides
the Worker address for the UI.

## License

See [LICENSE](LICENSE). Non-commercial use only; commercial use requires prior written permission.
