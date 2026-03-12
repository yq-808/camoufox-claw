import { BROWSER_ACTIONS, DAEMON_ACTIONS, browserToolName, formatBrowserDescription } from "../constants/actions";
import { resolveConfig } from "../config";
import { DaemonSupervisor } from "../daemon/supervisor";
import { InProcessMcpBridge } from "../mcp/bridge";
import { buildBrowserToolSchema, buildCommonSchema } from "../schema";
import type { BuildActionFn, PluginApi } from "../types";
import { sanitizePayload } from "../utils/payload";
import { readNumber, readObject } from "../utils/readers";
import { createToolExecutor } from "./execute";
import { camoufoxPromptHint } from "./promptHint";

export default function registerCamoufoxPlugin(api: PluginApi) {
  const baseConfig = resolveConfig(api);
  const daemon = new DaemonSupervisor();
  const bridge = new InProcessMcpBridge(daemon);
  const executeTool = createToolExecutor(baseConfig, daemon, bridge);

  api.on?.(
    "before_prompt_build",
    (event) => {
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
    (event) => {
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
    action: string,
    parameters: unknown,
    buildAction?: BuildActionFn,
  ) => {
    api.registerTool({
      name,
      description,
      parameters,
      execute: async (_id, params) => await executeTool(action, params, buildAction),
    });
  };

  registerTool("status", "Get Camoufox daemon and browser status.", DAEMON_ACTIONS.status, buildCommonSchema());
  registerTool("ensure", "Ensure Camoufox daemon and browser are started.", DAEMON_ACTIONS.ensure, buildCommonSchema());
  registerTool("stop", "Stop current browser session (daemon keeps running).", DAEMON_ACTIONS.stop, buildCommonSchema());
  registerTool("restart", "Restart browser session.", DAEMON_ACTIONS.restart, buildCommonSchema());
  registerTool("shutdown", "Shutdown Camoufox daemon process.", DAEMON_ACTIONS.shutdown, buildCommonSchema());

  for (const browserAction of BROWSER_ACTIONS) {
    registerTool(
      browserToolName(browserAction),
      formatBrowserDescription(browserAction),
      browserAction,
      buildBrowserToolSchema(browserAction),
      (params) => {
        const timeoutMs = readNumber(params, "timeoutMs");
        return {
          toolArgs: readObject(params, "params") ?? {},
          timeoutMs: timeoutMs ? Math.max(5000, Math.floor(timeoutMs)) : undefined,
        };
      },
    );
  }
}
