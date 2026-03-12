import fs from "node:fs";
import path from "node:path";

import { expandHomePath } from "../config";
import { DaemonSupervisor } from "../daemon/supervisor";
import type { PluginConfig } from "../types";
import { AsyncLock } from "../utils/asyncLock";
import { InMemoryTransport } from "./inMemoryTransport";
import { loadMcpRuntime, resolvePlaywrightModulesDir } from "./moduleLoader";

type BridgeSession = {
  endpoint: string;
  modulesDir: string;
  outputDir: string;
  server: any;
  client: any;
  browserPromise?: Promise<any>;
};

export class InProcessMcpBridge {
  private readonly lock = new AsyncLock();
  private session?: BridgeSession;

  constructor(private readonly daemon: DaemonSupervisor) {}

  async callTool(
    config: PluginConfig,
    toolName: string,
    argumentsPayload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    return await this.lock.run(async () => {
      const session = await this.ensureSession(config, timeoutMs);
      return await session.client.callTool(
        { name: toolName, arguments: argumentsPayload },
        undefined,
        { timeout: Math.max(1000, timeoutMs) },
      );
    });
  }

  async stop(): Promise<void> {
    await this.lock.run(async () => {
      await this.disposeSession();
    });
  }

  private async ensureSession(config: PluginConfig, timeoutMs: number): Promise<BridgeSession> {
    const endpoint = await this.daemon.ensureEndpoint(config, timeoutMs);
    const modulesDir = resolvePlaywrightModulesDir(config.playwrightMcpBin);
    const outputDir = path.resolve(expandHomePath(config.playwrightMcpOutputDir));

    if (
      this.session
      && this.session.endpoint === endpoint
      && this.session.modulesDir === modulesDir
      && this.session.outputDir === outputDir
    ) {
      return this.session;
    }

    await this.disposeSession();
    fs.mkdirSync(outputDir, { recursive: true });
    const runtime = loadMcpRuntime(modulesDir);
    const browserName = "firefox";
    let browserPromise: Promise<any> | undefined;

    const resolveBrowser = async () => {
      if (!browserPromise) {
        const browserType = runtime.playwright[browserName];
        if (!browserType || typeof browserType.connect !== "function") {
          throw new Error(`unsupported browser for bridge: ${browserName}`);
        }
        browserPromise = browserType.connect(endpoint).then((browser: any) => {
          browser.on("disconnected", () => {
            browserPromise = undefined;
          });
          return browser;
        }).catch((error: unknown) => {
          browserPromise = undefined;
          throw error;
        });
      }
      return await browserPromise;
    };

    const contextGetter = async () => {
      const browser = await resolveBrowser();
      const contexts = browser.contexts();
      if (!Array.isArray(contexts) || contexts.length === 0) {
        throw new Error(
          "no existing remote browser context; restart browser endpoint to recreate shared persistent context",
        );
      }
      return contexts[0];
    };

    const server = await runtime.createConnection({ outputDir }, contextGetter);
    const client = new runtime.Client(
      { name: "camoufox-claw-plugin", version: "0.1.0" },
      { capabilities: {} },
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport, { timeout: Math.max(1000, config.playwrightMcpStartupTimeoutMs) }),
    ]);
    await client.listTools(undefined, { timeout: Math.max(1000, config.playwrightMcpStartupTimeoutMs) });

    this.session = {
      endpoint,
      modulesDir,
      outputDir,
      server,
      client,
      browserPromise,
    };
    return this.session;
  }

  private async disposeSession(): Promise<void> {
    const session = this.session;
    this.session = undefined;
    if (!session) {
      return;
    }

    const browserPromise = session.browserPromise;
    try {
      if (session.client && typeof session.client.close === "function") {
        await session.client.close();
      }
    } catch {
      // best effort
    }
    try {
      if (session.server && typeof session.server.close === "function") {
        await session.server.close();
      }
    } catch {
      // best effort
    }
    if (browserPromise) {
      try {
        const browser = await browserPromise;
        if (browser && typeof browser.close === "function") {
          await browser.close();
        }
      } catch {
        // best effort
      }
    }
  }
}
