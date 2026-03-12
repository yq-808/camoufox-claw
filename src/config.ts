import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { CallOverrides, PluginConfig } from "./types";

export function expandHomePath(rawPath: string): string {
  if (rawPath === "~") {
    return os.homedir();
  }
  if (rawPath.startsWith("~/")) {
    return path.join(os.homedir(), rawPath.slice(2));
  }
  return rawPath;
}

export function resolveConfig(api: { pluginConfig?: Record<string, unknown> }): PluginConfig {
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
  const pluginTop = path.dirname(pluginRoot);
  return {
    pythonBin: pickString("pythonBin", "python3"),
    daemonPath: pickString("daemonPath", path.join(pluginTop, "scripts", "camoufox_daemon.py")),
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
    playwrightMcpBin: pickString("playwrightMcpBin", "~/.camoufox-claw/playwright-mcp/node_modules/.bin/playwright-mcp"),
    playwrightMcpStartupTimeoutMs: Math.max(1000, pickNumber("playwrightMcpStartupTimeoutMs", 30_000)),
    playwrightMcpOutputDir: pickString("playwrightMcpOutputDir", "~/.openclaw/media/camoufox-mcp"),
    proxyServer: typeof proxyRaw === "string" && proxyRaw.trim().length > 0 ? proxyRaw.trim() : undefined,
  };
}

export function withOverrides(base: PluginConfig, overrides: CallOverrides): PluginConfig {
  return {
    ...base,
    headless: overrides.headless ?? base.headless,
    proxyServer: overrides.proxyServer ?? base.proxyServer,
  };
}
