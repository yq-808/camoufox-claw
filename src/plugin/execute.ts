import { BROWSER_ACTION_SET } from "../constants/actions";
import { withOverrides } from "../config";
import { DaemonSupervisor } from "../daemon/supervisor";
import { InProcessMcpBridge } from "../mcp/bridge";
import type { BuildActionFn, PluginConfig } from "../types";
import { sanitizePayload, serializePayload } from "../utils/payload";
import { readBoolean, readNumber, readObject, readString } from "../utils/readers";
import { extractToolResultErrorText, formatToolError, validateClickToolArgs } from "../utils/toolErrors";

export function createToolExecutor(
  baseConfig: PluginConfig,
  daemon: DaemonSupervisor,
  bridge: InProcessMcpBridge,
) {
  return async function executeTool(
    action: string,
    paramsRaw: Record<string, unknown> | undefined,
    buildAction?: BuildActionFn,
  ): Promise<unknown> {
    const params = paramsRaw ?? {};
    const config = withOverrides(baseConfig, {
      headless: readBoolean(params, "headless"),
      proxyServer: readString(params, "proxyServer"),
    });
    if (action === "browser_click") {
      validateClickToolArgs(readObject(params, "params") ?? {});
    }

    const built = buildAction ? buildAction(params) : {};
    const timeoutOverride = readNumber(params, "timeoutMs");
    const timeoutMs = Math.max(
      5000,
      built.timeoutMs ?? timeoutOverride ?? config.startupTimeoutMs + 20_000,
    );

    if (BROWSER_ACTION_SET.has(action)) {
      const toolArgs = built.toolArgs ?? readObject(params, "params") ?? {};
      const result = await bridge.callTool(config, action, toolArgs, timeoutMs);
      const toolError = extractToolResultErrorText(result);
      if (toolError) {
        throw new Error(formatToolError(action, toolError));
      }
      return {
        content: [{
          type: "text",
          text: serializePayload(sanitizePayload(result ?? {})),
        }],
      };
    }

    if (daemon.stopForLifecycleAction(action)) {
      await bridge.stop();
    }
    const response = await daemon.invoke(config, action, timeoutMs);
    if (!response.ok) {
      throw new Error(formatToolError(action, response.error || "daemon call failed"));
    }
    const toolError = extractToolResultErrorText(response.result);
    if (toolError) {
      throw new Error(formatToolError(action, toolError));
    }
    return {
      content: [{
        type: "text",
        text: serializePayload(sanitizePayload(response.result ?? {})),
      }],
    };
  };
}
