#!/usr/bin/env bash
set -euo pipefail

HOST="root@47.112.6.140"
SSH_KEY="${HOME}/.ssh/id_ed25519"
REMOTE_DIR="/home/admin/code/camoufox-claw"
ADMIN_USER="admin"
GATEWAY_SERVICE="openclaw-gateway.service"
PROXY_SERVER=""
SKIP_RESTART="0"
FETCH_CAMOUFOX="0"
OFFLINE_CAMOUFOX="0"
CAMOUFOX_ASSET_URL=""
PLAYWRIGHT_MCP_VERSION="0.0.56"
LOCAL_OFFLINE_CACHE_TAR=""
LOCAL_OFFLINE_TMP_DIR=""
LOCAL_OFFLINE_ZIP=""
REMOTE_OFFLINE_CACHE_TAR=""

cleanup() {
  rm -f "${TMP_TAR:-}"
  rm -f "${LOCAL_OFFLINE_CACHE_TAR:-}"
  rm -f "${LOCAL_OFFLINE_ZIP:-}"
  if [[ -n "${LOCAL_OFFLINE_TMP_DIR:-}" ]]; then
    rm -rf "${LOCAL_OFFLINE_TMP_DIR}"
  fi
}
trap cleanup EXIT

usage() {
  cat <<'EOF'
Usage: deploy_to_vm.sh [options]

Options:
  --host <user@host>              SSH target (default: root@47.112.6.140)
  --ssh-key <path>                SSH private key (default: ~/.ssh/id_ed25519)
  --remote-dir <path>             Remote project path (default: /home/admin/code/camoufox-claw)
  --admin-user <user>             User running OpenClaw on VM (default: admin)
  --gateway-service <service>     User systemd service name (default: openclaw-gateway.service)
  --proxy-server <url>            Default proxy for Camoufox (e.g. socks5://127.0.0.1:11080)
  --offline-camoufox              Download Camoufox package locally and upload cache to VM
  --camoufox-asset-url <url>      Optional asset URL override for --offline-camoufox
  --fetch-camoufox                Run `python -m camoufox fetch` during deploy (slow, large download)
  --playwright-mcp-version <ver>  @playwright/mcp version to install (default: 0.0.56)
  --skip-restart                  Do not restart OpenClaw gateway service
  -h, --help                      Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      HOST="$2"
      shift 2
      ;;
    --ssh-key)
      SSH_KEY="$2"
      shift 2
      ;;
    --remote-dir)
      REMOTE_DIR="$2"
      shift 2
      ;;
    --admin-user)
      ADMIN_USER="$2"
      shift 2
      ;;
    --gateway-service)
      GATEWAY_SERVICE="$2"
      shift 2
      ;;
    --proxy-server)
      PROXY_SERVER="$2"
      shift 2
      ;;
    --offline-camoufox)
      OFFLINE_CAMOUFOX="1"
      shift 1
      ;;
    --camoufox-asset-url)
      CAMOUFOX_ASSET_URL="$2"
      shift 2
      ;;
    --playwright-mcp-version)
      PLAYWRIGHT_MCP_VERSION="$2"
      shift 2
      ;;
    --skip-restart)
      SKIP_RESTART="1"
      shift 1
      ;;
    --fetch-camoufox)
      FETCH_CAMOUFOX="1"
      shift 1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ ! -f "$SSH_KEY" ]]; then
  echo "SSH key not found: $SSH_KEY" >&2
  exit 1
fi

if [[ "$OFFLINE_CAMOUFOX" == "1" && "$FETCH_CAMOUFOX" == "1" ]]; then
  echo "--offline-camoufox and --fetch-camoufox are mutually exclusive." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_TAR="$(mktemp /tmp/camoufox-claw.XXXXXX.tgz)"
REMOTE_TAR="/tmp/camoufox-claw.$RANDOM.$RANDOM.tgz"

echo "Packing project from $ROOT_DIR"
tar \
  --exclude=".git" \
  --exclude=".venv" \
  --exclude="__pycache__" \
  --exclude="*.pyc" \
  -czf "$TMP_TAR" \
  -C "$ROOT_DIR" .

SSH_OPTS=(-o StrictHostKeyChecking=no -i "$SSH_KEY")

if [[ "$OFFLINE_CAMOUFOX" == "1" ]]; then
  if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 is required for --offline-camoufox" >&2
    exit 1
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required for --offline-camoufox" >&2
    exit 1
  fi

  echo "Detecting remote platform for offline Camoufox cache..."
  read -r REMOTE_OS REMOTE_ARCH_RAW < <(
    ssh "${SSH_OPTS[@]}" "$HOST" 'uname -s; uname -m' | tr '[:upper:]' '[:lower:]' | xargs
  )

  if [[ "$REMOTE_OS" != "linux" ]]; then
    echo "Unsupported remote OS for offline Camoufox cache: $REMOTE_OS" >&2
    exit 1
  fi

  case "$REMOTE_ARCH_RAW" in
    x86_64|amd64|x86)
      REMOTE_ARCH="x86_64"
      ;;
    aarch64|arm64|armv8*|armv9*)
      REMOTE_ARCH="arm64"
      ;;
    i686|i386)
      REMOTE_ARCH="i686"
      ;;
    *)
      echo "Unsupported remote architecture for Camoufox: $REMOTE_ARCH_RAW" >&2
      exit 1
      ;;
  esac

  echo "Resolving Camoufox release for linux/$REMOTE_ARCH..."
  mapfile -t CAMOUFOX_META < <(
    python3 - "$REMOTE_ARCH" "$CAMOUFOX_ASSET_URL" <<'PY'
import json
import re
import sys
import urllib.request

arch = sys.argv[1]
override_url = sys.argv[2].strip()
pattern = re.compile(rf"^camoufox-(?P<version>.+)-(?P<release>.+)-lin\.{re.escape(arch)}\.zip$")

if override_url:
    asset = override_url.rstrip("/").split("/")[-1]
    match = pattern.match(asset)
    if not match:
        raise SystemExit(f"Provided asset URL does not match linux/{arch}: {asset}")
    print(override_url)
    print(asset)
    print(match.group("version"))
    print(match.group("release"))
    raise SystemExit(0)

with urllib.request.urlopen("https://api.github.com/repos/daijro/camoufox/releases", timeout=30) as resp:
    releases = json.load(resp)

for release in releases:
    for asset in release.get("assets", []):
        name = asset.get("name", "")
        match = pattern.match(name)
        if match:
            print(asset["browser_download_url"])
            print(name)
            print(match.group("version"))
            print(match.group("release"))
            raise SystemExit(0)

raise SystemExit(f"No matching Camoufox release asset found for linux/{arch}")
PY
  )

  if [[ "${#CAMOUFOX_META[@]}" -ne 4 ]]; then
    echo "Failed to resolve Camoufox release metadata." >&2
    exit 1
  fi

  CAMOUFOX_ASSET_URL="${CAMOUFOX_META[0]}"
  CAMOUFOX_ASSET_NAME="${CAMOUFOX_META[1]}"
  CAMOUFOX_VERSION="${CAMOUFOX_META[2]}"
  CAMOUFOX_RELEASE="${CAMOUFOX_META[3]}"

  LOCAL_OFFLINE_ZIP="$(mktemp /tmp/camoufox-offline.XXXXXX.zip)"
  LOCAL_OFFLINE_TMP_DIR="$(mktemp -d /tmp/camoufox-cache.XXXXXX)"
  LOCAL_OFFLINE_CACHE_TAR="$(mktemp /tmp/camoufox-cache.XXXXXX.tgz)"

  echo "Downloading Camoufox asset locally: $CAMOUFOX_ASSET_NAME"
  curl -fL --retry 3 --retry-delay 2 -o "$LOCAL_OFFLINE_ZIP" "$CAMOUFOX_ASSET_URL"
  cp "$LOCAL_OFFLINE_ZIP" "$LOCAL_OFFLINE_TMP_DIR/$CAMOUFOX_ASSET_NAME"
  cat > "$LOCAL_OFFLINE_TMP_DIR/version.json" <<EOF
{"version":"$CAMOUFOX_VERSION","release":"$CAMOUFOX_RELEASE"}
EOF
  tar -czf "$LOCAL_OFFLINE_CACHE_TAR" -C "$LOCAL_OFFLINE_TMP_DIR" .
fi

PROXY_ARG="$PROXY_SERVER"
if [[ -z "$PROXY_ARG" ]]; then
  PROXY_ARG="__EMPTY__"
fi

echo "Uploading package to $HOST:$REMOTE_TAR"
scp "${SSH_OPTS[@]}" "$TMP_TAR" "$HOST:$REMOTE_TAR"
if [[ "$OFFLINE_CAMOUFOX" == "1" ]]; then
  REMOTE_OFFLINE_CACHE_TAR="/tmp/camoufox-cache.$RANDOM.$RANDOM.tgz"
  echo "Uploading offline Camoufox cache bundle to $HOST:$REMOTE_OFFLINE_CACHE_TAR"
  scp "${SSH_OPTS[@]}" "$LOCAL_OFFLINE_CACHE_TAR" "$HOST:$REMOTE_OFFLINE_CACHE_TAR"
fi

OFFLINE_CACHE_ARG="$REMOTE_OFFLINE_CACHE_TAR"
if [[ -z "$OFFLINE_CACHE_ARG" ]]; then
  OFFLINE_CACHE_ARG="__EMPTY__"
fi

echo "Running remote deployment on $HOST"
ssh "${SSH_OPTS[@]}" "$HOST" bash -s -- \
  "$REMOTE_TAR" \
  "$REMOTE_DIR" \
  "$ADMIN_USER" \
  "$GATEWAY_SERVICE" \
  "$PROXY_ARG" \
  "$SKIP_RESTART" \
  "$FETCH_CAMOUFOX" \
  "$OFFLINE_CACHE_ARG" \
  "$PLAYWRIGHT_MCP_VERSION" <<'REMOTE_EOF'
set -euo pipefail

REMOTE_TAR="$1"
REMOTE_DIR="$2"
ADMIN_USER="$3"
GATEWAY_SERVICE="$4"
PROXY_SERVER="$5"
SKIP_RESTART="$6"
FETCH_CAMOUFOX="$7"
OFFLINE_CACHE_TAR="$8"
PLAYWRIGHT_MCP_VERSION="$9"
if [[ "$PROXY_SERVER" == "__EMPTY__" ]]; then
  PROXY_SERVER=""
fi
if [[ "$OFFLINE_CACHE_TAR" == "__EMPTY__" ]]; then
  OFFLINE_CACHE_TAR=""
fi

cleanup_remote_artifacts() {
  rm -f "$REMOTE_TAR"
  if [[ -n "$OFFLINE_CACHE_TAR" ]]; then
    rm -f "$OFFLINE_CACHE_TAR"
  fi
}
trap cleanup_remote_artifacts EXIT

if ! id "$ADMIN_USER" >/dev/null 2>&1; then
  echo "Admin user does not exist: $ADMIN_USER" >&2
  exit 1
fi

ADMIN_HOME="$(getent passwd "$ADMIN_USER" | cut -d: -f6)"
if [[ -z "$ADMIN_HOME" ]]; then
  ADMIN_HOME="/home/$ADMIN_USER"
fi
cd "$ADMIN_HOME"

if ! sudo -u "$ADMIN_USER" -H bash -lc 'command -v openclaw >/dev/null 2>&1'; then
  echo "openclaw is not available for user $ADMIN_USER on remote host." >&2
  exit 1
fi

mkdir -p "$REMOTE_DIR"
tar -xzf "$REMOTE_TAR" -C "$REMOTE_DIR"
chown -R "$ADMIN_USER:$ADMIN_USER" "$REMOTE_DIR"
if [[ -n "$OFFLINE_CACHE_TAR" && -f "$OFFLINE_CACHE_TAR" ]]; then
  chmod 0644 "$OFFLINE_CACHE_TAR"
fi

sudo -u "$ADMIN_USER" -H env \
  REMOTE_DIR="$REMOTE_DIR" \
  PROXY_SERVER="$PROXY_SERVER" \
  FETCH_CAMOUFOX="$FETCH_CAMOUFOX" \
  OFFLINE_CACHE_TAR="$OFFLINE_CACHE_TAR" \
  PLAYWRIGHT_MCP_VERSION="$PLAYWRIGHT_MCP_VERSION" \
  bash -s <<'ADMIN_EOF'
set -euo pipefail

cd "$REMOTE_DIR"

OPENCLAW_BIN="$(command -v openclaw || true)"
if [[ -z "$OPENCLAW_BIN" && -x "$HOME/.local/share/pnpm/openclaw" ]]; then
  OPENCLAW_BIN="$HOME/.local/share/pnpm/openclaw"
fi
if [[ -z "$OPENCLAW_BIN" ]]; then
  echo "openclaw binary not found for user $USER" >&2
  exit 1
fi

if [[ ! -x "$HOME/.local/bin/uv" ]]; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
UV_BIN="$HOME/.local/bin/uv"
if [[ ! -x "$UV_BIN" ]]; then
  echo "uv install failed: $UV_BIN not found" >&2
  exit 1
fi

if [[ ! -x ".venv/bin/python" ]]; then
  "$UV_BIN" venv --python 3.11 .venv
fi
"$UV_BIN" pip install --python .venv/bin/python -r requirements.txt

if [[ -n "${OFFLINE_CACHE_TAR:-}" ]]; then
  if [[ ! -f "$OFFLINE_CACHE_TAR" ]]; then
    echo "Offline Camoufox cache tar not found: $OFFLINE_CACHE_TAR" >&2
    exit 1
  fi
  CACHE_TEMP_DIR="$(mktemp -d /tmp/camoufox-cache.unpack.XXXXXX)"
  tar -xzf "$OFFLINE_CACHE_TAR" -C "$CACHE_TEMP_DIR"
  ZIP_PATH="$(find "$CACHE_TEMP_DIR" -maxdepth 1 -type f -name 'camoufox-*.zip' | head -n 1)"
  VERSION_PATH="$CACHE_TEMP_DIR/version.json"
  if [[ -z "$ZIP_PATH" || ! -f "$VERSION_PATH" ]]; then
    echo "Offline cache bundle is invalid (zip/version.json missing)." >&2
    rm -rf "$CACHE_TEMP_DIR"
    exit 1
  fi

  CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}"
  TARGET_CACHE_DIR="$CACHE_ROOT/camoufox"
  STAGE_DIR="$(mktemp -d /tmp/camoufox-cache.stage.XXXXXX)"

  .venv/bin/python - "$ZIP_PATH" "$STAGE_DIR" <<'PY'
import os
import sys
import zipfile

zip_path, stage_dir = sys.argv[1], sys.argv[2]
os.makedirs(stage_dir, exist_ok=True)
with zipfile.ZipFile(zip_path) as zf:
    zf.extractall(stage_dir)
PY

  cp "$VERSION_PATH" "$STAGE_DIR/version.json"
  chmod -R 755 "$STAGE_DIR"
  rm -rf "$TARGET_CACHE_DIR"
  mkdir -p "$(dirname "$TARGET_CACHE_DIR")"
  mv "$STAGE_DIR" "$TARGET_CACHE_DIR"
  rm -rf "$CACHE_TEMP_DIR"
fi

if [[ "${FETCH_CAMOUFOX:-0}" == "1" ]]; then
  .venv/bin/python -m camoufox fetch
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to install @playwright/mcp for user $USER" >&2
  exit 1
fi

PLAYWRIGHT_MCP_HOME="$HOME/.camoufox-claw/playwright-mcp"
mkdir -p "$PLAYWRIGHT_MCP_HOME"
if [[ ! -f "$PLAYWRIGHT_MCP_HOME/package.json" ]]; then
  cat > "$PLAYWRIGHT_MCP_HOME/package.json" <<'JSON'
{
  "name": "camoufox-claw-playwright-mcp",
  "private": true
}
JSON
fi

npm --prefix "$PLAYWRIGHT_MCP_HOME" install --omit=dev --no-fund --no-audit \
  "@playwright/mcp@${PLAYWRIGHT_MCP_VERSION:-latest}"
PLAYWRIGHT_MCP_BIN="$PLAYWRIGHT_MCP_HOME/node_modules/.bin/playwright-mcp"
if [[ ! -x "$PLAYWRIGHT_MCP_BIN" && -x "$PLAYWRIGHT_MCP_HOME/node_modules/.bin/mcp-server-playwright" ]]; then
  ln -sf mcp-server-playwright "$PLAYWRIGHT_MCP_HOME/node_modules/.bin/playwright-mcp"
fi
if [[ ! -x "$PLAYWRIGHT_MCP_BIN" ]]; then
  echo "playwright-mcp binary not found after install: $PLAYWRIGHT_MCP_BIN" >&2
  exit 1
fi

VERIFY_ARGS=(--playwright-mcp-bin "$PLAYWRIGHT_MCP_BIN")
if [[ -n "${PROXY_SERVER:-}" ]]; then
  VERIFY_ARGS+=(--proxy-server "$PROXY_SERVER")
fi
.venv/bin/python scripts/verify_playwright_mcp.py "${VERIFY_ARGS[@]}"

"$OPENCLAW_BIN" plugins install -l "$REMOTE_DIR"
"$OPENCLAW_BIN" plugins enable camoufox-claw

"$OPENCLAW_BIN" config set plugins.entries.camoufox-claw.config.pythonBin "$REMOTE_DIR/.venv/bin/python"
"$OPENCLAW_BIN" config set plugins.entries.camoufox-claw.config.ctlPath "$REMOTE_DIR/scripts/camoufoxctl.py"
"$OPENCLAW_BIN" config set plugins.entries.camoufox-claw.config.daemonPath "$REMOTE_DIR/scripts/camoufox_daemon.py"
"$OPENCLAW_BIN" config set plugins.entries.camoufox-claw.config.host 127.0.0.1
"$OPENCLAW_BIN" config set plugins.entries.camoufox-claw.config.port 17888
"$OPENCLAW_BIN" config set plugins.entries.camoufox-claw.config.runtimeDir "$HOME/.camoufox-claw/runtime"
"$OPENCLAW_BIN" config set plugins.entries.camoufox-claw.config.userDataDir "$HOME/.camoufox-claw/profile"
"$OPENCLAW_BIN" config set plugins.entries.camoufox-claw.config.targetOs macos
"$OPENCLAW_BIN" config set plugins.entries.camoufox-claw.config.windowWidth 1280
"$OPENCLAW_BIN" config set plugins.entries.camoufox-claw.config.windowHeight 800
"$OPENCLAW_BIN" config set plugins.entries.camoufox-claw.config.locale zh-CN
"$OPENCLAW_BIN" config set plugins.entries.camoufox-claw.config.headless true
"$OPENCLAW_BIN" config set plugins.entries.camoufox-claw.config.excludeUbo true
"$OPENCLAW_BIN" config set plugins.entries.camoufox-claw.config.startupTimeoutMs 20000
"$OPENCLAW_BIN" config set plugins.entries.camoufox-claw.config.launchTimeoutMs 30000
"$OPENCLAW_BIN" config set plugins.entries.camoufox-claw.config.playwrightMcpBin "$PLAYWRIGHT_MCP_BIN"
"$OPENCLAW_BIN" config set plugins.entries.camoufox-claw.config.playwrightMcpStartupTimeoutMs 30000
"$OPENCLAW_BIN" config set plugins.entries.camoufox-claw.config.playwrightMcpOutputDir "$HOME/.openclaw/media/camoufox-mcp"

if [[ -n "${PROXY_SERVER:-}" ]]; then
  "$OPENCLAW_BIN" config set plugins.entries.camoufox-claw.config.defaultProxyServer "$PROXY_SERVER"
fi
ADMIN_EOF

if [[ "$SKIP_RESTART" != "1" ]]; then
  ADMIN_UID="$(id -u "$ADMIN_USER")"
  XDG_RUNTIME_DIR="/run/user/$ADMIN_UID"
  sudo -u "$ADMIN_USER" XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
    systemctl --user restart "$GATEWAY_SERVICE"
  sudo -u "$ADMIN_USER" XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
    systemctl --user is-active "$GATEWAY_SERVICE"
fi

sudo -u "$ADMIN_USER" -H bash -lc '
OPENCLAW_BIN="$(command -v openclaw || true)"
if [[ -z "$OPENCLAW_BIN" && -x "$HOME/.local/share/pnpm/openclaw" ]]; then
  OPENCLAW_BIN="$HOME/.local/share/pnpm/openclaw"
fi
"$OPENCLAW_BIN" plugins info camoufox-claw >/dev/null
'
echo "Deployment completed."
REMOTE_EOF

echo "Done."
