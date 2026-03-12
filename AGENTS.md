# Camoufox Claw Agent Notes

## Background

- Goal: run Camoufox from OpenClaw without modifying OpenClaw core code.
- Constraint: local machine may not have `openclaw`; deployment and config must happen on the remote VM over SSH.
- Runtime preference: no systemd for Camoufox itself. Tool calls must auto-start the Camoufox daemon when needed and keep a single running instance.
- OpenClaw on VM: expected to run under user `admin`.

## Architecture

- OpenClaw plugin tools for Camoufox live in this repository.
- Plugin entrypoint is `index.ts`, with implementation modules under `src/`.
- Plugin includes an in-process daemon supervisor that auto-starts and talks to `scripts/camoufox_daemon.py` over loopback TCP.
- `camoufox_daemon.py` enforces single-instance with a file lock and PID file.
- Daemon owns Camoufox endpoint lifecycle and serves commands (`status`, `ensure`, `stop`, `restart`, `shutdown`, `endpoint_ensure`).
- Browser tools are executed from plugin process via in-process Playwright MCP (`createConnection`) using daemon-provided websocket endpoint (`endpoint_ensure`).

## Deployment Model

- Deploy script syncs this directory to VM via SSH/SCP.
- Script installs a private Python runtime for `admin` using `uv` (Python 3.11+), then installs dependencies into `.venv`.
- Script runs closed-loop checks for the in-process plugin path (`scripts/verify_inprocess_bridge.cjs`).
- Script links plugin into OpenClaw (`openclaw plugins install -l <remote-dir>`), writes plugin config, and restarts OpenClaw gateway service.

## Operational Expectations

- Camoufox daemon is lazy-started on tool invocation.
- If daemon is already running, invocations reuse it.
- If daemon is dead/stale, plugin supervisor restarts it.
- Browser MCP session is process-local to OpenClaw plugin and reconnects when daemon endpoint changes.
- Verification should remain stageable in small units: daemon alive -> endpoint_ensure -> tools/list -> browser_navigate.
- Tooling is designed to be idempotent for repeated deploys.
