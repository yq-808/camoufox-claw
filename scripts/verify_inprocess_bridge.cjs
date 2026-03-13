#!/usr/bin/env node
"use strict";

const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { createRequire } = require("module");

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) throw new Error(`invalid arg: ${key}`);
    const name = key.slice(2);
    const val = argv[i + 1];
    if (!val || val.startsWith("--")) throw new Error(`missing value for ${key}`);
    out[name] = val;
    i += 1;
  }
  return out;
}

function expandHome(p) {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendRequest(host, port, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    let data = "";
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`daemon request timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    socket.on("connect", () => socket.write(`${JSON.stringify(payload)}\n`));
    socket.on("data", (chunk) => {
      data += String(chunk);
      const idx = data.indexOf("\n");
      if (idx < 0) return;
      clearTimeout(timer);
      socket.destroy();
      try {
        const parsed = JSON.parse(data.slice(0, idx));
        resolve(parsed);
      } catch (err) {
        reject(new Error(`invalid daemon json: ${String(err)}`));
      }
    });
    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function daemonAlive(host, port) {
  try {
    const resp = await sendRequest(host, port, { action: "ping" }, 1500);
    return !!resp.ok;
  } catch {
    return false;
  }
}

function spawnDaemon(config) {
  fs.mkdirSync(config.runtimeDirAbs, { recursive: true });
  const logPath = path.join(config.runtimeDirAbs, "daemon.log");
  const logFd = fs.openSync(logPath, "a");
  const args = [
    config.daemonPathAbs,
    "--host", config.host,
    "--port", String(config.port),
    "--runtime-dir", config.runtimeDirRaw,
    "--user-data-dir", config.userDataDirRaw,
    "--target-os", config.targetOs,
    "--window-width", String(config.windowWidth),
    "--window-height", String(config.windowHeight),
    "--locale", config.locale,
    "--endpoint-startup-timeout-ms", String(config.playwrightMcpStartupTimeoutMs),
    config.headless ? "--headless" : "--headed",
    config.excludeUbo ? "--exclude-ubo" : "--allow-ubo",
  ];
  if (config.proxyServer) args.push("--proxy-server", config.proxyServer);
  try {
    const child = spawn(config.pythonBinAbs, args, {
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    child.unref();
  } finally {
    fs.closeSync(logFd);
  }
}

function resolveModulesDir(playwrightMcpBinAbs) {
  const direct = path.resolve(path.dirname(playwrightMcpBinAbs), "..");
  if (fs.existsSync(direct)) return direct;
  const resolvedBin = fs.realpathSync(playwrightMcpBinAbs);
  const real = path.resolve(path.dirname(resolvedBin), "..");
  if (fs.existsSync(real)) return real;
  throw new Error(`playwright modules dir not found: ${real}`);
}

class InMemoryTransport {
  constructor() {
    this.queue = [];
    this.other = undefined;
    this.onmessage = undefined;
    this.onclose = undefined;
  }

  static createLinkedPair() {
    const clientTransport = new InMemoryTransport();
    const serverTransport = new InMemoryTransport();
    clientTransport.other = serverTransport;
    serverTransport.other = clientTransport;
    return [clientTransport, serverTransport];
  }

  async start() {
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (item) this.onmessage?.(item.message, item.extra);
    }
  }

  async close() {
    const other = this.other;
    this.other = undefined;
    if (other) await other.close();
    this.onclose?.();
  }

  async send(message, options) {
    if (!this.other) throw new Error("Not connected");
    const extra = { authInfo: options?.authInfo };
    if (this.other.onmessage) {
      this.other.onmessage(message, extra);
      return;
    }
    this.other.queue.push({ message, extra });
  }
}

async function main() {
  const a = parseArgs(process.argv);
  const config = {
    pythonBinAbs: path.resolve(expandHome(a.pythonBin || "python3")),
    daemonPathAbs: path.resolve(expandHome(a.daemonPath)),
    host: a.host || "127.0.0.1",
    port: Number(a.port || 17888),
    runtimeDirRaw: a.runtimeDir || "~/.camoufox-claw/runtime",
    runtimeDirAbs: path.resolve(expandHome(a.runtimeDir || "~/.camoufox-claw/runtime")),
    userDataDirRaw: a.userDataDir || "~/.camoufox-claw/profile",
    targetOs: a.targetOs || "macos",
    windowWidth: Number(a.windowWidth || 1280),
    windowHeight: Number(a.windowHeight || 800),
    locale: a.locale || "zh-CN",
    playwrightMcpBinRaw: a.playwrightMcpBin,
    playwrightMcpBinAbs: path.resolve(expandHome(a.playwrightMcpBin)),
    playwrightMcpStartupTimeoutMs: Number(a.playwrightMcpStartupTimeoutMs || 30000),
    playwrightMcpOutputDirAbs: path.resolve(expandHome(a.playwrightMcpOutputDir || "~/.openclaw/media/camoufox-mcp")),
    proxyServer: (a.proxyServer || "").trim(),
    headless: (a.headless || "true") === "true",
    excludeUbo: (a.excludeUbo || "true") === "true",
  };

  const stages = [];
  if (!await daemonAlive(config.host, config.port)) {
    spawnDaemon(config);
    const deadline = Date.now() + Number(a.startupTimeoutMs || 20000);
    while (Date.now() < deadline) {
      if (await daemonAlive(config.host, config.port)) break;
      await wait(250);
    }
  }
  if (!await daemonAlive(config.host, config.port)) throw new Error("daemon failed to start");
  stages.push("daemon_alive");

  let endpointResp = await sendRequest(
    config.host,
    config.port,
    { action: "endpoint_ensure", timeoutMs: config.playwrightMcpStartupTimeoutMs },
    Math.max(3000, config.playwrightMcpStartupTimeoutMs),
  );
  if (!endpointResp.ok) throw new Error(endpointResp.error || "endpoint_ensure failed");
  const wsEndpoint = endpointResp.result && endpointResp.result.wsEndpoint;
  if (typeof wsEndpoint !== "string" || !wsEndpoint) throw new Error("missing wsEndpoint");
  stages.push("endpoint_ensure");

  fs.mkdirSync(config.playwrightMcpOutputDirAbs, { recursive: true });
  const modulesDir = resolveModulesDir(config.playwrightMcpBinAbs);
  const req = createRequire(path.join(modulesDir, ".camoufox-claw-verify-loader.cjs"));
  const mcpBundle = req("playwright-core/lib/mcpBundle");
  const { createConnection } = req("@playwright/mcp");
  const { Client } = mcpBundle;
  const playwright = req("playwright");

  let browser;
  const contextGetter = async () => {
    if (!browser) browser = await playwright.firefox.connect(wsEndpoint);
    const contexts = browser.contexts();
    if (!Array.isArray(contexts) || !contexts.length) {
      throw new Error("no remote contexts");
    }
    return contexts[0];
  };

  const server = await createConnection({ outputDir: config.playwrightMcpOutputDirAbs }, contextGetter);
  const client = new Client(
    { name: "camoufox-claw-verify", version: "0.1.0" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport, { timeout: config.playwrightMcpStartupTimeoutMs }),
  ]);

  const tools = await client.listTools(undefined, { timeout: config.playwrightMcpStartupTimeoutMs });
  if (!Array.isArray(tools.tools) || !tools.tools.length) throw new Error("tools/list returned empty");
  stages.push("tools_list");

  const nav = await client.callTool(
    { name: "browser_navigate", arguments: { url: a.testUrl || "https://example.com" } },
    undefined,
    { timeout: Math.max(8000, config.playwrightMcpStartupTimeoutMs) },
  );
  stages.push("mcp_browser_navigate");

  const runCode = await client.callTool(
    {
      name: "browser_run_code",
      arguments: {
        code: "async (page) => { await page.keyboard.press('End'); return await page.title(); }",
      },
    },
    undefined,
    { timeout: Math.max(8000, config.playwrightMcpStartupTimeoutMs) },
  );
  stages.push("mcp_browser_run_code");

  await client.close().catch(() => {});
  await server.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});

  process.stdout.write(`${JSON.stringify({
    ok: true,
    stages,
    wsEndpoint,
    toolCount: tools.tools.length,
    navigateResult: nav,
    runCodeResult: runCode,
  })}\n`);
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    error: error instanceof Error ? (error.stack || error.message) : String(error),
  })}\n`);
  process.exit(1);
});
