# PRD – AI Workspace

## Overview

AI Workspace is a local-first desktop application for managing AI-powered development environments running across one or more machines.

Instead of remotely controlling computers, users reconnect to persistent AI workspaces containing active coding agents, local development environments, browser sessions, previews, and project context.

The system is designed to be privacy-first. By default, no project data, source code, prompts, files, or AI conversations are uploaded to external servers.

## Core Principles

- Local-first
- Privacy-first
- Zero stored customer data
- Persistent AI workspaces
- Multi-machine support
- AI-native interface
- Works with any AI coding agent

## Architecture

### Worker
Installed on every Mac or workstation.

Responsibilities: launch AI agents, track sessions, monitor terminal output, expose local resources, manage previews, stream updates, handle approvals.

Supported integrations: Claude Code, Codex CLI, Gemini CLI, OpenHands, Roo Code, Docker, Git, MCP Servers.

### Desktop App
The control center. View connected workstations, continue AI conversations, monitor progress, browse files, preview websites, watch rendered videos, inspect images, read logs, approve actions, open terminals.

### Local Connectivity
Default communication is direct: Desktop App → encrypted connection → Worker.

Supported transports: Tailscale, WireGuard, Local Network, SSH Tunnel. No cloud infrastructure required.

### Optional Relay
For users who need remote access without VPNs. The relay only forwards encrypted traffic and is completely stateless — it never stores repositories, prompts, AI conversations, terminal history, videos, images, project files, or databases.

## MVP Features

- **AI Dashboard** — every connected workstation: online status, current repo, running agent, active task, progress, resource usage.
- **Persistent Chat** — ChatGPT-like interface per session; continue conversations without rebuilding context.
- **Localhost Preview** — auto-detect local web servers (Next.js, React, Vite, Rails, Django, Laravel); built-in browser for live previews.
- **Media Preview** — videos, images, PDFs, markdown, HTML, without manual downloads.
- **Terminal** — interactive terminal connected to the running workspace.
- **File Explorer** — browse repos, preview files without downloading.
- **Approval Center** — handle AI permission requests (git push, file deletion, docker commands, package installation).
- **Notifications** — task completion, test failures, build success, waiting approvals, agent interruptions.

## Long-Term Vision

AI Workspace becomes the operating system for AI-powered software development. Developers no longer think about connecting to individual machines; they interact with persistent AI workspaces that retain context, maintain long-running tasks, and expose every development resource through a unified interface. The physical machine becomes an implementation detail. The workspace becomes the product.
