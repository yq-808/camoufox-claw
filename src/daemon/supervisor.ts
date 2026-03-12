import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import { expandHomePath } from "../config";
import { AsyncLock } from "../utils/asyncLock";
import type { DaemonResponse, PluginConfig } from "../types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DaemonSupervisor {
  private readonly lock = new AsyncLock();

  async invoke(config: PluginConfig, action: string, timeoutMs: number): Promise<DaemonResponse> {
    return await this.lock.run(async () => await this.invokeLocked(config, action, timeoutMs));
  }

  async ensureEndpoint(config: PluginConfig, timeoutMs: number): Promise<string> {
    return await this.lock.run(async () => {
      await this.ensureDaemonLocked(config);
      const response = await this.sendRequest(
        config,
        { action: "endpoint_ensure", timeoutMs: Math.max(1000, timeoutMs) },
        Math.max(3000, timeoutMs),
      );
      if (!response.ok) {
        throw new Error(response.error || "endpoint_ensure failed");
      }
      const result = response.result as Record<string, unknown> | undefined;
      const wsEndpoint = typeof result?.wsEndpoint === "string" ? result.wsEndpoint.trim() : "";
      if (!wsEndpoint) {
        throw new Error("endpoint_ensure returned empty wsEndpoint");
      }
      return wsEndpoint;
    });
  }

  stopForLifecycleAction(action: string): boolean {
    return action === "ensure" || action === "stop" || action === "restart" || action === "shutdown";
  }

  private async invokeLocked(config: PluginConfig, action: string, timeoutMs: number): Promise<DaemonResponse> {
    if (action === "restart") {
      if (await this.daemonAlive(config)) {
        try {
          await this.sendRequest(config, { action: "shutdown" }, Math.max(3000, timeoutMs));
        } catch {
          // best effort
        }
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          if (!await this.daemonAlive(config)) {
            break;
          }
          await sleep(200);
        }
      }
      await this.ensureDaemonLocked(config);
      return await this.sendRequest(config, { action: "ensure" }, Math.max(3000, timeoutMs));
    }

    await this.ensureDaemonLocked(config);
    return await this.sendRequest(config, { action }, Math.max(3000, timeoutMs));
  }

  private async ensureDaemonLocked(config: PluginConfig): Promise<void> {
    if (await this.daemonAlive(config)) {
      return;
    }
    this.startDaemon(config);
    const deadline = Date.now() + Math.max(500, config.startupTimeoutMs);
    while (Date.now() < deadline) {
      if (await this.daemonAlive(config)) {
        return;
      }
      await sleep(250);
    }
    throw new Error("daemon failed to start within timeout");
  }

  private startDaemon(config: PluginConfig): void {
    const runtimeDir = path.resolve(expandHomePath(config.runtimeDir));
    fs.mkdirSync(runtimeDir, { recursive: true });
    const logPath = path.join(runtimeDir, "daemon.log");
    const logFd = fs.openSync(logPath, "a");

    const daemonArgs = [
      expandHomePath(config.daemonPath),
      "--host", config.host,
      "--port", String(config.port),
      "--runtime-dir", config.runtimeDir,
      "--user-data-dir", config.userDataDir,
      "--target-os", config.targetOs,
      "--window-width", String(config.windowWidth),
      "--window-height", String(config.windowHeight),
      "--locale", config.locale,
      "--endpoint-startup-timeout-ms", String(config.playwrightMcpStartupTimeoutMs),
      config.headless ? "--headless" : "--headed",
      config.excludeUbo ? "--exclude-ubo" : "--allow-ubo",
    ];
    if (config.proxyServer) {
      daemonArgs.push("--proxy-server", config.proxyServer);
    }

    try {
      const child = spawn(expandHomePath(config.pythonBin), daemonArgs, {
        detached: true,
        stdio: ["ignore", logFd, logFd],
      });
      child.unref();
    } finally {
      fs.closeSync(logFd);
    }
  }

  private async daemonAlive(config: PluginConfig): Promise<boolean> {
    try {
      const resp = await this.sendRequest(config, { action: "ping" }, 1500);
      return Boolean(resp.ok);
    } catch {
      return false;
    }
  }

  private async sendRequest(
    config: PluginConfig,
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<DaemonResponse> {
    return await new Promise<DaemonResponse>((resolve, reject) => {
      let buffer = "";
      let finished = false;
      const socket = net.createConnection({ host: config.host, port: config.port });

      const finish = (err?: Error, response?: DaemonResponse) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        socket.destroy();
        if (err) reject(err);
        else resolve(response ?? { ok: false, error: "empty response from daemon" });
      };

      const timer = setTimeout(() => {
        finish(new Error(`daemon request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      socket.on("connect", () => socket.write(`${JSON.stringify(payload)}\n`));
      socket.on("error", (err) => finish(err instanceof Error ? err : new Error(String(err))));
      socket.on("data", (chunk) => {
        buffer += String(chunk);
        const nl = buffer.indexOf("\n");
        if (nl === -1) return;
        const line = buffer.slice(0, nl).trim();
        if (!line) return finish(new Error("empty response from daemon"));
        try {
          const parsed = JSON.parse(line);
          if (!parsed || typeof parsed !== "object") {
            return finish(new Error("invalid daemon response type"));
          }
          return finish(undefined, parsed as DaemonResponse);
        } catch (err) {
          return finish(new Error(`failed to parse daemon response JSON: ${String(err)}`));
        }
      });
      socket.on("close", () => {
        if (!finished) {
          finish(new Error("daemon connection closed without response"));
        }
      });
    });
  }
}
