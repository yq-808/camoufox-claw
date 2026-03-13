export const DAEMON_ACTIONS = {
  status: "status",
  ensure: "ensure",
  stop: "stop",
  restart: "restart",
  shutdown: "shutdown",
} as const;

export const BROWSER_ACTIONS = [
  "browser_click",
  "browser_close",
  "browser_drag",
  "browser_file_upload",
  "browser_fill_form",
  "browser_handle_dialog",
  "browser_hover",
  "browser_navigate",
  "browser_navigate_back",
  "browser_press_key",
  "browser_resize",
  "browser_run_code",
  "browser_select_option",
  "browser_snapshot",
  "browser_take_screenshot",
  "browser_type",
  "browser_wait_for",
  "browser_tabs",
  "browser_mouse_click_xy",
  "browser_mouse_down",
  "browser_mouse_drag_xy",
  "browser_mouse_move_xy",
  "browser_mouse_up",
  "browser_mouse_wheel",
  "browser_generate_locator",
] as const;

export type BrowserAction = (typeof BROWSER_ACTIONS)[number];

export const BROWSER_ACTION_SET = new Set<string>(BROWSER_ACTIONS);

export function browserToolName(browserAction: BrowserAction): string {
  return browserAction.replace(/^browser_/, "");
}

export function formatBrowserDescription(browserAction: BrowserAction): string {
  const runCodeExample = browserAction === "browser_run_code"
    ? " Example params.code: async (page) => { await page.getByRole('textbox').first().click(); await page.keyboard.type('Line 1'); await page.keyboard.press('Enter'); await page.keyboard.type('Line 2'); return await page.title(); }"
    : "";
  return [
    `Camoufox browser operation (${browserAction}). Put operation arguments in "params".${runCodeExample}`,
    "Note: browser state is shared across OpenClaw sessions/channels.",
    "If the page/context appears to belong to another session, tell the user first and ask whether to continue.",
  ].join(" ");
}
