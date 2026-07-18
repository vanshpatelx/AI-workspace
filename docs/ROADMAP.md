# AI Workspace — Roadmap & Milestones

Status legend: ✅ done · 🚧 in progress · ⬜ not started

## Foundation

| # | Milestone | Status | Notes |
|---|-----------|--------|-------|
| 0 | Repo + monorepo scaffold | ✅ | pnpm workspace, protocol/transport packages, 3 apps, custom license |
| 1 | Wire protocol (Desktop⇄Worker⇄Relay types) | ✅ | `@ai-workspace/protocol` discriminated unions |
| 2 | WebSocket transport (server + reconnecting client) | ✅ | `@ai-workspace/transport`, verified end-to-end |
| 3 | `aiw` CLI — `init` / `start` / `status` | ✅ | config at `~/.ai-workspace/worker.json`, `--yes` unattended mode |
| 4 | Keep-awake manager (caffeinate power assertion) | ✅ | policy: while-active / always / off, tied to task activity |
| 5 | Agent detection (which CLIs are installed) | ✅ | probes claude/codex/gemini/openhands/roo on PATH |

| 16 | Multi-machine (many Workers, one Desktop) | ✅ | Desktop multiplexes N Worker connections, each with its own chat/approvals/commands; `AIW_HOME` lets several Workers coexist; verified with 2 live Workers |

## Next up

| # | Milestone | Status | Notes |
|---|-----------|--------|-------|
| 6 | Claude Code agent adapter | ✅ | spawns `claude -p` stream-json, streams real output over `chat.delta`, keep-awake per turn |
| 7 | Session store to disk (persistent chat) | ✅ | transcript + agent native session id persisted to `~/.ai-workspace/sessions.json`; history replayed on connect; verified across a Worker restart (agent still recalled context) |
| 8 | Desktop UI: React + Tailwind + shadcn-style | ✅ | dashboard + persistent chat, live WebSocket to Worker (Electron shell = D3) |
| 9 | Pairing / auth (Desktop trusts a Worker) | ✅ | pairing code is a shared secret; no state or actions before auth; UI pairing screen persists to localStorage |
| 10 | Approval Center (git push / rm / docker gating) | ✅ | command runner + classifier; sensitive actions gated, approve/reject in UI, verified (reject blocks, approve runs) |
| 10b | **Agent** actions routed through the Approval Center | ✅ | Claude Code `PreToolUse` hook → Worker loopback endpoint → Approval Center; agent blocks mid-turn until the user decides |
| 11 | Terminal streaming | ✅ | real PTY (node-pty) streamed to xterm.js; start/input/resize/close + exit; verified with live shell output |
| 12 | Localhost preview (detect dev servers) | ✅ | lsof-based detection + HTML probe, framework guess, framed through a Worker-side proxy so previews work for remote Workers and past X-Frame-Options |
| 13 | File explorer + media preview | ✅ | browse the repo, inline preview of text/images/video/audio/PDF via data URIs; path traversal blocked at the Worker (verified over the raw protocol) |
| 14 | Notifications | ✅ | structured events (task done, command complete/failed, approval waiting, agent error) in an in-app center with unread badge, plus native OS notifications |
| 15 | Optional stateless relay | ⬜ | forward encrypted frames for remote access without VPN |

## Distribution

| # | Milestone | Status | Notes |
|---|-----------|--------|-------|
| D1 | Worker install: `curl \| sh` → `aiw` binary | ✅ | install.sh clones, builds, links `aiw`; `aiw ui` serves the built Desktop UI; verified running the full stack from `dist` |
| D2 | Worker auto-start as launchd service | ✅ | `aiw service install/uninstall/status` writes a LaunchAgent with RunAtLoad + KeepAlive; verified the Worker starts, serves, and is restarted by launchd after being killed |
| D3 | Desktop `.dmg` download (Electron build) | ✅ | Electron shell (contextIsolation, no nodeIntegration) + electron-builder DMG; verified by mounting a locally built DMG |
| D4 | CI + release automation | ✅ | GitHub Actions: typecheck/build on every push plus a clean-machine `install.sh` smoke test; tagged releases build the DMG (arm64+x64) and a CLI tarball with checksums |
