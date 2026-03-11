# camoufox-claw

OpenClaw plugin + daemon bridge for operating Camoufox with a single long-lived process.

## What it does

- Adds a `camoufox` OpenClaw tool.
- Auto-starts a local Camoufox daemon on first call.
- Keeps one daemon/browser process and reuses it across calls.
- Exposes actions like `status`, `ensure`, `navigate`, `snapshot`, `screenshot`, `stop`, `restart`, `shutdown`.

## Layout

- `index.ts`: OpenClaw plugin tool definition.
- `openclaw.plugin.json`: plugin manifest + config schema.
- `scripts/camoufox_daemon.py`: long-lived Camoufox process.
- `scripts/camoufoxctl.py`: command client and auto-start manager.
- `deploy/deploy_to_vm.sh`: SSH deploy + remote OpenClaw config script.
- `scripts/verify_playwright_mcp.py`: deploy-time end-to-end check for Camoufox endpoint + Playwright MCP.

## Deploy

```bash
cd ~/code/camoufox-claw
cp .env.example .env
# edit .env with your VM host/user/path
./deploy/deploy_to_vm.sh
```

`deploy/deploy_to_vm.sh` now loads deploy defaults from `.env` in repo root. CLI flags still override `.env`.

Deploy now also installs `@playwright/mcp` on the VM (`~/.camoufox-claw/playwright-mcp`) and runs a closed-loop verify:
1) launch Camoufox Playwright ws endpoint
2) start playwright-mcp with `remoteEndpoint`
3) run MCP `initialize` / `tools/list` / `tools/call(browser_navigate)`

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
