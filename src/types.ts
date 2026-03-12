export type PluginConfig = {
  pythonBin: string;
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
  playwrightMcpBin: string;
  playwrightMcpStartupTimeoutMs: number;
  playwrightMcpOutputDir: string;
  proxyServer?: string;
};

export type CallOverrides = {
  headless?: boolean;
  proxyServer?: string;
};

export type DaemonResponse = {
  ok?: boolean;
  result?: unknown;
  error?: string;
};

export type BuildActionResult = {
  timeoutMs?: number;
  toolArgs?: Record<string, unknown>;
};

export type BuildActionFn = (params: Record<string, unknown>) => BuildActionResult;

export type RegisteredTool = {
  name: string;
  description: string;
  parameters: unknown;
  execute: (id: string, params: Record<string, unknown>) => Promise<unknown>;
};

export type PromptBuildEvent = {
  prompt?: string;
  messages?: unknown[];
};

export type PromptBuildResult = {
  prependContext?: string;
};

export type ToolResultPersistEvent = {
  message?: unknown;
  toolName?: string;
};

export type ToolResultPersistResult = {
  message?: unknown;
};

export type PluginApi = {
  pluginConfig?: Record<string, unknown>;
  registerTool: (tool: RegisteredTool) => void;
  on?: (
    hookName: string,
    handler:
      | ((event: PromptBuildEvent) => PromptBuildResult | void)
      | ((event: ToolResultPersistEvent) => ToolResultPersistResult | void),
    opts?: { priority?: number },
  ) => void;
};
