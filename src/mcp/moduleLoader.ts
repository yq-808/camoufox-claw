import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import { expandHomePath } from "../config";

type McpRuntime = {
  createConnection: (config?: Record<string, unknown>, contextGetter?: () => Promise<unknown>) => Promise<any>;
  Client: new (...args: any[]) => any;
  playwright: Record<string, any>;
};

const runtimeCache = new Map<string, McpRuntime>();

export function resolvePlaywrightModulesDir(playwrightMcpBin: string): string {
  const expanded = path.resolve(expandHomePath(playwrightMcpBin));
  const direct = path.resolve(path.dirname(expanded), "..");
  if (fs.existsSync(direct)) {
    return direct;
  }
  const resolvedBin = fs.realpathSync(expanded);
  const fromResolved = path.resolve(path.dirname(resolvedBin), "..");
  if (fs.existsSync(fromResolved)) {
    return fromResolved;
  }
  throw new Error(`playwright modules directory not found: ${fromResolved}`);
}

export function loadMcpRuntime(modulesDir: string): McpRuntime {
  const cached = runtimeCache.get(modulesDir);
  if (cached) {
    return cached;
  }

  const requireFromModules = createRequire(path.join(modulesDir, ".camoufox-claw-loader.cjs"));
  const mcpBundle = requireFromModules("playwright-core/lib/mcpBundle");
  const { createConnection } = requireFromModules("@playwright/mcp");
  const { Client } = mcpBundle;
  const playwright = requireFromModules("playwright");

  const runtime = {
    createConnection,
    Client,
    playwright,
  };
  runtimeCache.set(modulesDir, runtime);
  return runtime;
}
