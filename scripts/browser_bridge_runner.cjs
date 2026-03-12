#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const Module = require("module");

function fail(message, error) {
  const detail = error instanceof Error ? error.stack || error.message : String(error || "");
  const suffix = detail ? `\n${detail}` : "";
  process.stderr.write(`[browser-bridge] ${message}${suffix}\n`);
  process.exit(1);
}

function readRequiredEnv(name) {
  const value = (process.env[name] || "").trim();
  if (!value) {
    fail(`missing required env: ${name}`);
  }
  return value;
}

function addNodePath(modulesDir) {
  const resolved = path.resolve(modulesDir);
  process.env.NODE_PATH = process.env.NODE_PATH
    ? `${resolved}${path.delimiter}${process.env.NODE_PATH}`
    : resolved;
  Module._initPaths();
}

const wsEndpoint = readRequiredEnv("CAMOUFOX_BRIDGE_WS_ENDPOINT");
const outputDir = readRequiredEnv("CAMOUFOX_BRIDGE_OUTPUT_DIR");
const modulesDir = readRequiredEnv("CAMOUFOX_BRIDGE_MODULES_DIR");
const browserName = (process.env.CAMOUFOX_BRIDGE_BROWSER || "firefox").trim().toLowerCase();
const closeMode = (process.env.CAMOUFOX_BRIDGE_CLOSE_MODE || "real").trim().toLowerCase();

if (!fs.existsSync(modulesDir)) {
  fail(`modules directory does not exist: ${modulesDir}`);
}

addNodePath(modulesDir);
fs.mkdirSync(outputDir, { recursive: true });

const { createConnection } = require("@playwright/mcp");
const mcpBundle = require("playwright-core/lib/mcpBundle");
const playwright = require("playwright");

let browserPromise;

async function resolveBrowser() {
  if (!browserPromise) {
    const browserType = playwright[browserName];
    if (!browserType || typeof browserType.connect !== "function") {
      throw new Error(`unsupported browser for bridge: ${browserName}`);
    }
    browserPromise = browserType.connect(wsEndpoint).then((browser) => {
      browser.on("disconnected", () => {
        browserPromise = undefined;
      });
      return browser;
    }).catch((error) => {
      browserPromise = undefined;
      throw error;
    });
  }
  return await browserPromise;
}

function maybeWrapContext(context) {
  if (closeMode === "real") {
    return context;
  }
  if (closeMode !== "noop") {
    throw new Error(`unknown CAMOUFOX_BRIDGE_CLOSE_MODE: ${closeMode}`);
  }
  return new Proxy(context, {
    get(target, property, receiver) {
      if (property === "close") {
        return async () => {};
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function contextGetter() {
  const browser = await resolveBrowser();
  const contexts = browser.contexts();
  if (!Array.isArray(contexts) || contexts.length === 0) {
    throw new Error(
      "no existing remote browser context; restart browser endpoint to recreate shared persistent context",
    );
  }
  return maybeWrapContext(contexts[0]);
}

(async () => {
  const connection = await createConnection({ outputDir }, contextGetter);
  const transport = new mcpBundle.StdioServerTransport();
  await connection.connect(transport);
})().catch((error) => {
  fail("bridge runner failed to start", error);
});
