# camoufox-claw

OpenClaw plugin + daemon bridge for operating Camoufox with a single long-lived process.

## What it does

- Adds Camoufox lifecycle + browser tools to OpenClaw.
- Auto-starts a local Camoufox daemon on first call.
- Keeps one daemon/browser process and reuses it across calls.
- Lifecycle actions are daemon-backed: `status`, `ensure`, `stop`, `restart`, `shutdown`.
- Browser actions are Playwright MCP-backed (for example: `navigate`, `snapshot`, `take_screenshot`, `click`, `type`, `run_code`).

## Runtime Flow

1) OpenClaw calls plugin tool in `index.ts`.
2) Plugin daemon supervisor (Node, in `src/daemon`) auto-starts/reuses `scripts/camoufox_daemon.py` via loopback TCP.
3) Plugin requests `endpoint_ensure` from daemon and gets Camoufox Playwright ws endpoint.
4) Plugin executes browser tools with in-process Playwright MCP (`createConnection`) via in-memory transport.

## Layout

- `index.ts`: OpenClaw plugin entrypoint.
- `src/`: plugin modules (config, daemon supervisor, in-process MCP bridge, schemas, tool wiring).
- `openclaw.plugin.json`: plugin manifest + config schema.
- `scripts/camoufox_daemon.py`: long-lived Camoufox process.
- `deploy/deploy_to_vm.sh`: SSH deploy + remote OpenClaw config script.
- `scripts/verify_inprocess_bridge.cjs`: deploy-time verification for plugin runtime path (daemon `endpoint_ensure` + in-process MCP call path).

## Deploy

```bash
cd ~/code/camoufox-claw
cp .env.example .env
# edit .env with your VM host/user/path
./deploy/deploy_to_vm.sh
```

`deploy/deploy_to_vm.sh` now loads deploy defaults from `.env` in repo root. CLI flags still override `.env`.

Deploy now also installs `@playwright/mcp` on the VM (`~/.camoufox-claw/playwright-mcp`) and runs a closed-loop verify:
1) ensure daemon is alive
2) ensure endpoint is available (`endpoint_ensure`)
3) run in-process MCP `tools/list`
4) run in-process MCP `browser_navigate`
5) run in-process MCP `browser_run_code`

Optional proxy:

```bash
./deploy/deploy_to_vm.sh --proxy-server socks5://127.0.0.1:11080
```

Pin Playwright MCP version:

```bash
./deploy/deploy_to_vm.sh --playwright-mcp-version 0.0.68
```

Offline Camoufox bootstrap (recommended when VM download is slow):

```bash
./deploy/deploy_to_vm.sh --offline-camoufox
```

Optional custom asset URL for offline mode:

```bash
./deploy/deploy_to_vm.sh --offline-camoufox --camoufox-asset-url https://github.com/daijro/camoufox/releases/download/<tag>/camoufox-<version>-<release>-lin.x86_64.zip
```
