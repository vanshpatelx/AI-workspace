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

## Next up

| # | Milestone | Status | Notes |
|---|-----------|--------|-------|
| 6 | Claude Code agent adapter | ✅ | spawns `claude -p` stream-json, streams real output over `chat.delta`, keep-awake per turn |
| 7 | Session store to disk (persistent chat) | 🚧 | in-memory session→native-id map done; disk persistence pending |
| 8 | Desktop UI: React + Tailwind + shadcn-style | ✅ | dashboard + persistent chat, live WebSocket to Worker (Electron shell = D3) |
| 9 | Pairing / auth (Desktop trusts a Worker) | ✅ | pairing code is a shared secret; no state or actions before auth; UI pairing screen persists to localStorage |
| 10 | Approval Center (git push / rm / docker gating) | ✅ | command runner + classifier; sensitive actions gated, approve/reject in UI, verified (reject blocks, approve runs) |
| 11 | Terminal streaming | ⬜ | interactive PTY over the transport |
| 12 | Localhost preview (detect dev servers) | ⬜ | Next.js/Vite/Rails/Django tunneled into Desktop |
| 13 | File explorer + media preview | ⬜ | browse repo, preview images/video/PDF/markdown |
| 14 | Notifications | ⬜ | task done / test failed / build ok / waiting approval |
| 15 | Optional stateless relay | ⬜ | forward encrypted frames for remote access without VPN |

## Distribution

| # | Milestone | Status | Notes |
|---|-----------|--------|-------|
| D1 | Worker install: `curl \| sh` → `aiw` binary | ⬜ | interactive `aiw worker init` wizard already built |
| D2 | Worker auto-start as launchd service | ⬜ | survive reboots |
| D3 | Desktop `.dmg` download (Electron build) | ⬜ | GitHub Releases + auto-update later |
