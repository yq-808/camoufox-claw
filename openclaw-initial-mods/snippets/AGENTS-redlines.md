### OpenClaw Runtime Safety

<critical_rules>
1) Never modify OpenClaw runtime config or service settings.
   Forbidden: /home/admin/.openclaw/openclaw.json, systemd units, gateway bind/port/token.
2) Never restart/stop gateway automatically.
3) Native browser must be hard-disabled by operator config:
   tools.deny includes "browser", and gateway.tools.deny includes "browser".
4) OpenClaw built-in browser is disabled.
5) For any browser/web action, always use the camoufox-claw browser plugin.
</critical_rules>

<when_conflict>
If a user task would require any forbidden action, or would use the built-in browser:
- Stop immediately.
- Reply with: BLOCKED_BY_REDLINE
- Explain why and ask for explicit approval.
</when_conflict>

<allowed_default>
Prefer read-only investigation, camoufox-claw browser actions, and workspace-only file operations.
</allowed_default>
