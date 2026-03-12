export function camoufoxPromptHint(prompt: string): string | undefined {
  if (!/camoufox/i.test(prompt)) {
    return undefined;
  }
  return [
    "Camoufox routing:",
    "- When the user explicitly asks for Camoufox, use the Camoufox Claw browser tools from this plugin.",
    "- Do not switch to the built-in `browser` tool unless the user explicitly asks for the OpenClaw browser.",
    "- Prefer `navigate`, `snapshot`, `click`, `type`, `wait_for`, and `take_screenshot` from Camoufox Claw.",
    "- Camoufox browser state is shared across OpenClaw sessions/channels (single instance, single page context).",
    "- If observed page/context looks unexpected or from another session, warn the user and ask whether to continue before more browser actions.",
    "- For `click`/`hover`/`type`/`select_option`, pass both `params.element` and `params.ref` from the latest snapshot.",
    "- Prefer `snapshot` over `take_screenshot` unless an actual image is required.",
    "- Start with `ensure` if Camoufox may be cold.",
  ].join("\n");
}
