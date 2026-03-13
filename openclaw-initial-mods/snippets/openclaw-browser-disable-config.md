### OpenClaw Native Browser Disable (Config)

Set both keys in `~/.openclaw/openclaw.json`:

- `tools.deny` contains `"browser"`
- `gateway.tools.deny` contains `"browser"`

Quick verify:

```bash
jq '.tools.deny, .gateway.tools.deny' ~/.openclaw/openclaw.json
```

Note:

- `~/camoufox-claw/deploy/deploy_to_vm.sh` does not set these two deny keys.
