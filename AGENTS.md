# Camoufox Claw Agent Notes

## Background

- Goal: run Camoufox from OpenClaw without modifying OpenClaw core code.
- Constraint: local machine may not have `openclaw`; deployment and config must happen on the remote VM over SSH.
- Runtime preference: no systemd for Camoufox itself. Tool calls must auto-start the Camoufox daemon when needed and keep a single running instance.
- OpenClaw on VM: expected to run under user `admin`.

## Architecture

- OpenClaw plugin tool (`camoufox`) lives in this repository.
- Plugin delegates execution to `scripts/camoufoxctl.py`.
- `camoufoxctl.py` auto-starts and talks to `scripts/camoufox_daemon.py` over loopback TCP.
- `camoufox_daemon.py` enforces single-instance with a file lock and PID file.
- Daemon keeps one long-lived Camoufox browser context/page and serves commands (`status`, `ensure`, `navigate`, `snapshot`, etc.).

## Deployment Model

- Deploy script syncs this directory to VM via SSH/SCP.
- Script installs a private Python runtime for `admin` using `uv` (Python 3.11+), then installs dependencies into `.venv`.
- Script links plugin into OpenClaw (`openclaw plugins install -l <remote-dir>`), writes plugin config, and restarts OpenClaw gateway service.

## Operational Expectations

- Camoufox daemon is lazy-started on tool invocation.
- If daemon is already running, invocations reuse it.
- If daemon is dead/stale, `camoufoxctl.py` restarts it.
- Tooling is designed to be idempotent for repeated deploys.
