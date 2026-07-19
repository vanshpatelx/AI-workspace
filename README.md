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
and drag it to Applications.

The build is ad-hoc signed rather than notarized (that needs a paid Apple
developer account), so macOS will not open it on the first try. Right-click
the app and choose **Open**, then confirm.

If macOS instead claims the app **"is damaged and can't be opened"**, that is
Gatekeeper's message for a quarantined app it will not verify — the download
is fine. Clear the quarantine flag and open it:

```bash
xattr -cr "/Applications/AI Workspace.app"
open "/Applications/AI Workspace.app"
```

> Releases before `v0.1.2` shipped an invalid signature and always showed the
> "damaged" message; upgrade, or use the command above.

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

## Mirroring a simulator

The **Device** tab streams a running iOS Simulator or Android emulator from the
Worker's machine and lets you drive it. A dev server can be proxied because it
speaks HTTP; a simulator cannot, so frames are captured and input is injected.

Seeing the screen needs nothing beyond Xcode (iOS) or `adb` (Android). Tapping
is where the platforms diverge:

| | see screen | tap / type |
| --- | --- | --- |
| **Android** | `adb` | same `adb` binary — nothing extra |
| **iOS** | works out of the box | needs [idb](https://fbidb.io) |

Apple ships no tap injection, so iOS needs Meta's `idb`. Until it is installed
the device is marked view-only and the panel shows the command; rescan once it
is in place.

```sh
brew install facebook/fb/idb-companion
pipx install --python python3.12 fb-idb
```

Both details matter. `pip install fb-idb` fails on a current Mac because
Homebrew's Python is externally-managed (PEP 668), and `idb` itself calls
`asyncio.get_event_loop()` at startup, which raises on Python 3.13+ — so an
install that appears to succeed then throws a traceback on every command. pipx
gives it an isolated environment, and pinning 3.12 keeps it running.

Expect roughly **10fps** — enough to tap through a flow and check a layout, not
enough for animations or gestures. iOS Simulator also needs a logged-in desktop
session: it will not launch over a bare SSH connection, though Android will.

## Remote access

Direct transports (Tailscale, WireGuard, LAN, SSH tunnel) need no extra
infrastructure and are genuinely end-to-end — prefer them.

If you cannot connect directly, an optional [relay](docs/RELAY.md) forwards
frames between a Desktop and a Worker and stores nothing. Note that it can
currently *read* traffic in transit, so run your own — the trust model is
documented in full in [docs/RELAY.md](docs/RELAY.md).

## License

See [LICENSE](LICENSE). Non-commercial use only; commercial use requires prior written permission.
