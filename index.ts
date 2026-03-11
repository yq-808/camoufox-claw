import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

type PluginConfig = {
  pythonBin: string;
  ctlPath: string;
  daemonPath: string;
  host: string;
  port: number;
  runtimeDir: string;
  userDataDir: string;
  targetOs: "windows" | "macos" | "linux";
  windowWidth: number;
  windowHeight: number;
  locale: string;
  headless: boolean;
  excludeUbo: boolean;
  startupTimeoutMs: number;
  launchTimeoutMs: number;
  playwrightMcpBin: string;
  playwrightMcpStartupTimeoutMs: number;
  playwrightMcpOutputDir: string;
  proxyServer?: string;
};

type CallOverrides = {
  headless?: boolean;
  proxyServer?: string;
};

type CtlResponse = {
  ok?: boolean;
  result?: unknown;
  error?: string;
};

type BuildActionResult = {
  actionArgs: string[];
  timeoutMs?: number;
};

type BuildActionFn = (params: Record<string, unknown>) => BuildActionResult;

type RegisteredTool = {
  name: string;
  description: string;
  parameters: unknown;
  execute: (id: string, params: Record<string, unknown>) => Promise<unknown>;
};

type PromptBuildEvent = {
  prompt?: string;
  messages?: unknown[];
};

type PromptBuildResult = {
  prependContext?: string;
};

type ToolResultPersistEvent = {
  message?: unknown;
  toolName?: string;
};

type ToolResultPersistResult = {
  message?: unknown;
};

type PluginApi = {
  pluginConfig?: Record<string, unknown>;
  registerTool: (tool: RegisteredTool) => void;
  on?: (
    hookName: string,
    handler: ((event: PromptBuildEvent) => PromptBuildResult | void) | ((event: ToolResultPersistEvent) => ToolResultPersistResult | void),
    opts?: { priority?: number },
  ) => void;
};

const DAEMON_ACTIONS = {
  status: "status",
  ensure: "ensure",
  stop: "stop",
  restart: "restart",
  shutdown: "shutdown",
} as const;

const BROWSER_ACTIONS = [
  "browser_click",
  "browser_close",
  "browser_console_messages",
  "browser_drag",
  "browser_evaluate",
  "browser_file_upload",
  "browser_fill_form",
  "browser_handle_dialog",
  "browser_hover",
  "browser_navigate",
  "browser_navigate_back",
  "browser_network_requests",
  "browser_press_key",
  "browser_resize",
  "browser_run_code",
  "browser_select_option",
  "browser_snapshot",
  "browser_take_screenshot",
  "browser_type",
  "browser_wait_for",
  "browser_tabs",
  "browser_install",
  "browser_mouse_click_xy",
  "browser_mouse_down",
  "browser_mouse_drag_xy",
  "browser_mouse_move_xy",
  "browser_mouse_up",
  "browser_mouse_wheel",
  "browser_pdf_save",
  "browser_generate_locator",
  "browser_verify_element_visible",
  "browser_verify_list_visible",
  "browser_verify_text_visible",
  "browser_verify_value",
] as const;

const COMMON_OVERRIDE_PROPERTIES = {
  timeoutMs: {
    type: "number",
    description: "Optional timeout in milliseconds for this call.",
  },
  proxyServer: {
    type: "string",
    description: "Optional proxy override, e.g. socks5://127.0.0.1:11080",
  },
  headless: {
    type: "boolean",
    description: "Optional headless override",
  },
} as const;

const MAX_TEXT_FIELD_CHARS = 12_000;
const MAX_SERIALIZED_PAYLOAD_CHARS = 24_000;
const TRUNCATION_SUFFIX = "\n...[truncated for OpenClaw context size]";

function readString(
  raw: Record<string, unknown>,
  key: string,
  opts?: { required?: boolean },
): string | undefined {
  const value = raw[key];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  if (opts?.required) {
    throw new Error(`Missing required string parameter: ${key}`);
  }
  return undefined;
}

function readBoolean(raw: Record<string, unknown>, key: string): boolean | undefined {
  const value = raw[key];
  if (typeof value === "boolean") {
    return value;
  }
  return undefined;
}

function readNumber(raw: Record<string, unknown>, key: string): number | undefined {
  const value = raw[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

function readObject(raw: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = raw[key];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function validateClickToolArgs(rawToolArgs: Record<string, unknown>): void {
  const element = readString(rawToolArgs, "element");
  const ref = readString(rawToolArgs, "ref");
  const locator = readString(rawToolArgs, "locator")
    ?? readString(rawToolArgs, "selector")
    ?? readString(rawToolArgs, "target");
  if (element && ref) {
    return;
  }
  const missing = [!element ? "element" : "", !ref ? "ref" : ""].filter(Boolean).join(", ");
  const locatorHint = locator
    ? " `locator`/`selector` is not accepted by this click schema on the current backend."
    : "";
  throw new Error(
    `[camoufox-claw] retryable=true: click requires params.element + params.ref from the latest snapshot; missing ${missing}.${locatorHint} `
    + "Please call `snapshot` and retry click with both fields.",
  );
}

function isClickContractError(errorText: string): boolean {
  return /invalid_type/i.test(errorText)
    && (/\"path\":\s*\[\s*\"element\"\s*\]/i.test(errorText)
      || /\"path\":\s*\[\s*\"ref\"\s*\]/i.test(errorText)
      || /Required/i.test(errorText));
}

function isRefNotFoundError(errorText: string): boolean {
  return /Ref\s+e\d+\s+not found/i.test(errorText);
}

function isClickRetryableFailure(errorText: string): boolean {
  return isRefNotFoundError(errorText)
    || /TimeoutError:\s*locator\.click/i.test(errorText)
    || /intercepts pointer events/i.test(errorText)
    || /timed out/i.test(errorText);
}

function formatToolError(ctlAction: string, error: string): string {
  const base = error || "camoufoxctl failed";
  if (ctlAction === "browser_click" && isClickContractError(base)) {
    return `${base}\n[camoufox-claw] retryable=true: click requires params.element + params.ref. `
      + "Retry with a fresh snapshot and pass both fields.";
  }
  if (ctlAction === "browser_click" && isRefNotFoundError(base)) {
    return `${base}\n[camoufox-claw] retryable=true: stale ref detected. `
      + "Call snapshot first to refresh refs, then retry click with element+ref.";
  }
  if (ctlAction === "browser_click" && isClickRetryableFailure(base)) {
    return `${base}\n[camoufox-claw] retryable=true: click was blocked or timed out. `
      + "Refresh snapshot and retry; if overlay blocks input, dismiss it before clicking.";
  }
  return base;
}

function extractToolResultErrorText(result: unknown): string | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }
  const record = result as Record<string, unknown>;
  if (record.isError !== true) {
    return undefined;
  }
  const content = record.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item && typeof item === "object") {
        const text = (item as Record<string, unknown>).text;
        if (typeof text === "string" && text.trim().length > 0) {
          return text.trim();
        }
      }
    }
  }
  return JSON.stringify(record);
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  const keep = Math.max(256, maxChars - TRUNCATION_SUFFIX.length);
  return `${value.slice(0, keep)}${TRUNCATION_SUFFIX}`;
}

function summarizeImagePayload(item: Record<string, unknown>): Record<string, unknown> {
  const mimeType = typeof item.mimeType === "string" && item.mimeType ? item.mimeType : "image";
  const data = typeof item.data === "string" ? item.data : "";
  const note = `[${mimeType} omitted from tool output; removed ${data.length} base64 chars]`;
  return {
    type: "text",
    text: note,
  };
}

function sanitizePayload(value: unknown): unknown {
  if (typeof value === "string") {
    return truncateText(value, MAX_TEXT_FIELD_CHARS);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizePayload(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  if (record.type === "image" && typeof record.data === "string") {
    return summarizeImagePayload(record);
  }

  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (key === "details") {
      continue;
    }
    next[key] = sanitizePayload(entry);
  }
  return next;
}

function serializePayload(payload: unknown): string {
  const text = JSON.stringify(payload, null, 2);
  return truncateText(text, MAX_SERIALIZED_PAYLOAD_CHARS);
}

function camoufoxPromptHint(prompt: string): string | undefined {
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

function resolveConfig(api: { pluginConfig?: Record<string, unknown> }): PluginConfig {
  const pluginRoot = path.dirname(fileURLToPath(import.meta.url));
  const cfg = api.pluginConfig ?? {};
  const pickString = (key: string, fallback: string) => {
    const raw = cfg[key];
    return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : fallback;
  };
  const pickNumber = (key: string, fallback: number) => {
    const raw = cfg[key];
    return typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : fallback;
  };
  const pickBoolean = (key: string, fallback: boolean) => {
    const raw = cfg[key];
    return typeof raw === "boolean" ? raw : fallback;
  };

  const proxyRaw = cfg.defaultProxyServer;
  const targetOsRaw = pickString("targetOs", "macos").toLowerCase();
  const targetOs = targetOsRaw === "windows" || targetOsRaw === "linux" || targetOsRaw === "macos"
    ? targetOsRaw
    : "macos";
  return {
    pythonBin: pickString("pythonBin", "python3"),
    ctlPath: pickString("ctlPath", path.join(pluginRoot, "scripts", "camoufoxctl.py")),
    daemonPath: pickString("daemonPath", path.join(pluginRoot, "scripts", "camoufox_daemon.py")),
    host: pickString("host", "127.0.0.1"),
    port: Math.max(1, Math.min(65535, pickNumber("port", 17888))),
    runtimeDir: pickString("runtimeDir", "~/.camoufox-claw/runtime"),
    userDataDir: pickString("userDataDir", "~/.camoufox-claw/profile"),
    targetOs,
    windowWidth: Math.max(800, pickNumber("windowWidth", 1280)),
    windowHeight: Math.max(600, pickNumber("windowHeight", 800)),
    locale: pickString("locale", "zh-CN"),
    headless: pickBoolean("headless", true),
    excludeUbo: pickBoolean("excludeUbo", true),
    startupTimeoutMs: Math.max(500, pickNumber("startupTimeoutMs", 20_000)),
    launchTimeoutMs: Math.max(1000, pickNumber("launchTimeoutMs", 30_000)),
    playwrightMcpBin: pickString(
      "playwrightMcpBin",
      "~/.camoufox-claw/playwright-mcp/node_modules/.bin/playwright-mcp",
    ),
    playwrightMcpStartupTimeoutMs: Math.max(
      1000,
      pickNumber("playwrightMcpStartupTimeoutMs", 30_000),
    ),
    playwrightMcpOutputDir: pickString("playwrightMcpOutputDir", "~/.openclaw/media/camoufox-mcp"),
    proxyServer: typeof proxyRaw === "string" && proxyRaw.trim().length > 0 ? proxyRaw.trim() : undefined,
  };
}

function withOverrides(base: PluginConfig, overrides: CallOverrides): PluginConfig {
  return {
    ...base,
    headless: overrides.headless ?? base.headless,
    proxyServer: overrides.proxyServer ?? base.proxyServer,
  };
}

async function runCtl(config: PluginConfig, actionArgs: string[], timeoutMs: number): Promise<CtlResponse> {
  const commandArgs = [
    config.ctlPath,
    "--host",
    config.host,
    "--port",
    String(config.port),
    "--runtime-dir",
    config.runtimeDir,
    "--user-data-dir",
    config.userDataDir,
    "--target-os",
    config.targetOs,
    "--window-width",
    String(config.windowWidth),
    "--window-height",
    String(config.windowHeight),
    "--locale",
    config.locale,
    "--python-bin",
    config.pythonBin,
    "--daemon-path",
    config.daemonPath,
    "--startup-timeout-ms",
    String(config.startupTimeoutMs),
    "--launch-timeout-ms",
    String(config.launchTimeoutMs),
    "--playwright-mcp-bin",
    config.playwrightMcpBin,
    "--playwright-mcp-startup-timeout-ms",
    String(config.playwrightMcpStartupTimeoutMs),
    "--playwright-mcp-output-dir",
    config.playwrightMcpOutputDir,
    "--json",
    config.headless ? "--headless" : "--headed",
    config.excludeUbo ? "--exclude-ubo" : "--allow-ubo",
  ];
  if (config.proxyServer) {
    commandArgs.push("--proxy-server", config.proxyServer);
  }
  commandArgs.push(...actionArgs);

  return await new Promise<CtlResponse>((resolve, reject) => {
    const proc = spawn(config.pythonBin, commandArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`camoufoxctl timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    proc.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      const text = stdout.trim();
      if (!text) {
        const detail = stderr.trim() || `camoufoxctl exited with code ${code ?? "unknown"}`;
        reject(new Error(detail));
        return;
      }
      try {
        const parsed = JSON.parse(text) as CtlResponse;
        if (code && code !== 0 && parsed.ok !== true) {
          resolve(parsed);
          return;
        }
        resolve(parsed);
      } catch (err) {
        reject(
          new Error(
            `failed to parse camoufoxctl output as JSON: ${
              err instanceof Error ? err.message : String(err)
            }\nstdout=${text}\nstderr=${stderr.trim()}`,
          ),
        );
      }
    });
  });
}

function buildCommonSchema(extraProperties?: Record<string, unknown>) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      ...(extraProperties ?? {}),
      ...COMMON_OVERRIDE_PROPERTIES,
    },
  } as const;
}

function browserToolName(browserAction: (typeof BROWSER_ACTIONS)[number]): string {
  return browserAction.replace(/^browser_/, "");
}

function formatBrowserDescription(browserAction: (typeof BROWSER_ACTIONS)[number]): string {
  return [
    `Camoufox browser operation (${browserAction}). Put operation arguments in \"params\".`,
    "Note: browser state is shared across OpenClaw sessions/channels.",
    "If the page/context appears to belong to another session, tell the user first and ask whether to continue.",
  ].join(" ");
}

async function executeTool(
  baseConfig: PluginConfig,
  ctlAction: string,
  paramsRaw: Record<string, unknown> | undefined,
  buildAction?: BuildActionFn,
): Promise<unknown> {
  const params = paramsRaw ?? {};
  const config = withOverrides(baseConfig, {
    headless: readBoolean(params, "headless"),
    proxyServer: readString(params, "proxyServer"),
  });

  if (ctlAction === "browser_click") {
    validateClickToolArgs(readObject(params, "params") ?? {});
  }
  const built = buildAction ? buildAction(params) : { actionArgs: [] };
  const timeoutOverride = readNumber(params, "timeoutMs");
  const timeoutMs = Math.max(
    5000,
    built.timeoutMs ?? timeoutOverride ?? config.startupTimeoutMs + 20_000,
  );

  const response = await runCtl(config, [ctlAction, ...built.actionArgs], timeoutMs);
  const toolError = response.ok ? extractToolResultErrorText(response.result) : undefined;

  if (!response.ok) {
    throw new Error(formatToolError(ctlAction, response.error || "camoufoxctl failed"));
  }
  if (toolError) {
    throw new Error(formatToolError(ctlAction, toolError));
  }
  const payload = sanitizePayload(response.result ?? {});
  return {
    content: [{
      type: "text",
      text: serializePayload(payload),
    }],
  };
}

export default function registerCamoufoxPlugin(api: PluginApi) {
  const baseConfig = resolveConfig(api);

  api.on?.(
    "before_prompt_build",
    (event: PromptBuildEvent) => {
      const prompt = typeof event.prompt === "string" ? event.prompt : "";
      const prependContext = camoufoxPromptHint(prompt);
      if (!prependContext) {
        return undefined;
      }
      return { prependContext };
    },
    { priority: 50 },
  );

  api.on?.(
    "tool_result_persist",
    (event: ToolResultPersistEvent) => {
      const message = event.message;
      if (!message || typeof message !== "object") {
        return undefined;
      }
      const record = message as Record<string, unknown>;
      if (record.role !== "toolResult") {
        return undefined;
      }
      const next = sanitizePayload(record) as Record<string, unknown>;
      if (typeof event.toolName === "string" && event.toolName.trim().length > 0) {
        next.toolName = event.toolName.trim();
      }
      return { message: next };
    },
    { priority: 50 },
  );

  const registerTool = (
    name: string,
    description: string,
    ctlAction: string,
    parameters: unknown,
    buildAction?: BuildActionFn,
  ) => {
    api.registerTool({
      name,
      description,
      parameters,
      execute: async (_id, params) => {
        return await executeTool(baseConfig, ctlAction, params, buildAction);
      },
    });
  };

  registerTool(
    "status",
    "Get Camoufox daemon and browser status.",
    DAEMON_ACTIONS.status,
    buildCommonSchema(),
  );
  registerTool(
    "ensure",
    "Ensure Camoufox daemon and browser are started.",
    DAEMON_ACTIONS.ensure,
    buildCommonSchema(),
  );
  registerTool(
    "stop",
    "Stop current browser session (daemon keeps running).",
    DAEMON_ACTIONS.stop,
    buildCommonSchema(),
  );
  registerTool(
    "restart",
    "Restart browser session.",
    DAEMON_ACTIONS.restart,
    buildCommonSchema(),
  );
  registerTool(
    "shutdown",
    "Shutdown Camoufox daemon process.",
    DAEMON_ACTIONS.shutdown,
    buildCommonSchema(),
  );

  for (const browserAction of BROWSER_ACTIONS) {
    registerTool(
      browserToolName(browserAction),
      formatBrowserDescription(browserAction),
      browserAction,
      buildCommonSchema({
        params: {
          type: "object",
          additionalProperties: true,
          description: "Operation arguments for this method.",
        },
      }),
      (params) => {
        const toolArgs = readObject(params, "params") ?? {};
        const actionArgs: string[] = ["--tool-args-json", JSON.stringify(toolArgs)];
        const timeoutMs = readNumber(params, "timeoutMs");
        if (typeof timeoutMs === "number") {
          actionArgs.push("--timeout-ms", String(Math.max(1000, Math.floor(timeoutMs))));
        }
        return {
          actionArgs,
          timeoutMs: timeoutMs ? Math.max(5000, Math.floor(timeoutMs)) : undefined,
        };
      },
    );
  }
}
