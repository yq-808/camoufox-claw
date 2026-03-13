export function camoufoxPromptHint(prompt: string): string | undefined {
  if (!/camoufox/i.test(prompt)) {
    return undefined;
  }
  return [
    "Camoufox routing:",
    "- When the user explicitly asks for Camoufox, use the Camoufox Claw browser tools from this plugin.",
    "- Do not switch to the built-in `browser` tool unless the user explicitly asks for the OpenClaw browser.",
    "- Prefer `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_wait_for`, and `browser_take_screenshot` from Camoufox Claw.",
    "- Camoufox browser state is shared across OpenClaw sessions/channels (single instance, single page context).",
    "- If observed page/context looks unexpected or from another session, warn the user and ask whether to continue before more browser actions.",
    "- For `browser_click`/`browser_hover`/`browser_type`/`browser_select_option`, pass both `params.element` and `params.ref` from the latest snapshot.",
    "- Prefer `browser_snapshot` over `browser_take_screenshot` unless an actual image is required.",
    "- Start with `ensure` if Camoufox may be cold.",
  ].join("\n");
}
