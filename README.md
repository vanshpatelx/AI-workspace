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

## License

See [LICENSE](LICENSE). Non-commercial use only; commercial use requires prior written permission.
