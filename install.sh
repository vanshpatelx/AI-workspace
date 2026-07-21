#!/usr/bin/env bash
#
# AI Workspace installer.
#
#   curl -fsSL https://raw.githubusercontent.com/vanshpatelx/Otter/main/install.sh | bash
#
# Installs the Worker (the `aiw` CLI) into ~/.ai-workspace/app and links it
# onto your PATH. Everything stays on this machine; nothing is uploaded.

set -euo pipefail

REPO="${AIW_REPO:-https://github.com/vanshpatelx/Otter.git}"
BRANCH="${AIW_BRANCH:-main}"
APP_DIR="${AIW_APP_DIR:-$HOME/.ai-workspace/app}"
BIN_DIR="${AIW_BIN_DIR:-$HOME/.local/bin}"

info() { printf '\033[1;36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33mwarn:\033[0m %s\n' "$1"; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$1" >&2; exit 1; }

# --- preflight ---------------------------------------------------------------
command -v git >/dev/null 2>&1 || die "git is required"
command -v node >/dev/null 2>&1 || die "Node.js 20+ is required (https://nodejs.org)"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js 20+ required (found $(node -v))"

if ! command -v pnpm >/dev/null 2>&1; then
  info "pnpm not found — enabling via corepack"
  corepack enable >/dev/null 2>&1 || die "could not enable pnpm; install it from https://pnpm.io"
fi

# --- fetch -------------------------------------------------------------------
if [ -d "$APP_DIR/.git" ]; then
  info "Updating existing install in $APP_DIR"
  git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  info "Cloning into $APP_DIR"
  mkdir -p "$(dirname "$APP_DIR")"
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$APP_DIR"
fi

# --- build -------------------------------------------------------------------
info "Installing dependencies"
(cd "$APP_DIR" && pnpm install --silent)

info "Building"
# The desktop bundle (Monaco plus syntax grammars) needs more heap than Node
# allows by default — without this the build aborts on lower-memory machines.
(cd "$APP_DIR" && NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=6144}" pnpm -r build >/dev/null)

# --- link --------------------------------------------------------------------
mkdir -p "$BIN_DIR"
ln -sf "$APP_DIR/apps/worker/dist/cli.js" "$BIN_DIR/aiw"
chmod +x "$APP_DIR/apps/worker/dist/cli.js"
info "Linked aiw -> $BIN_DIR/aiw"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) warn "$BIN_DIR is not on your PATH. Add this to your shell profile:"
     printf '\n    export PATH="%s:$PATH"\n\n' "$BIN_DIR" ;;
esac

# --- done --------------------------------------------------------------------
cat <<'EOF'

  AI Workspace installed.

  Next steps:
    aiw worker init      configure this machine (transport, keep-awake, agents)
    aiw worker start     run the Worker
    aiw ui               open the Desktop UI at http://127.0.0.1:5180

  Pair the UI with the code from `aiw worker status`.

EOF
