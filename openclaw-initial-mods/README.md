# OpenClaw Initial Modifications

This repository stores my initial OpenClaw safety-prompt customization.

## Included

- `snippets/AGENTS-redlines.md`: the runtime redline block added to `AGENTS.md`.
- `snippets/openclaw-browser-disable-config.md`: exact config keys to hard-disable native browser.
- `scripts/apply_redlines.sh`: inserts `snippets/AGENTS-redlines.md` into a target `AGENTS.md`.
- `skills/xiaohongshu-interact/SKILL.md`: XiaoHongShu interaction skill.
- `skills/xiaohongshu-profile/SKILL.md`: XiaoHongShu profile extraction skill.
- `skills/xiaohongshu-publish/SKILL.md`: XiaoHongShu content publish skill.
- `skills/xiaohongshu-search/SKILL.md`: XiaoHongShu search skill.

## Notes

- This repo intentionally excludes runtime configs, tokens, logs, and personal memory files.
- The goal is to preserve only the policy text change.
