import type { BrowserAction } from "../constants/actions";
import { BROWSER_SCHEMAS_A } from "./browserSchemasA";
import { BROWSER_SCHEMAS_B } from "./browserSchemasB";
import { BROWSER_SCHEMAS_C } from "./browserSchemasC";

const STRICT_EMPTY_OBJECT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

export const COMMON_OVERRIDE_PROPERTIES = {
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

const BROWSER_ACTION_INPUT_SCHEMAS: Partial<Record<BrowserAction, Record<string, unknown>>> = {
  ...BROWSER_SCHEMAS_A,
  ...BROWSER_SCHEMAS_B,
  ...BROWSER_SCHEMAS_C,
};

function cloneSchema<T>(schema: T): T {
  return JSON.parse(JSON.stringify(schema)) as T;
}

function hasRequiredParams(schema: Record<string, unknown>): boolean {
  const required = schema.required;
  return Array.isArray(required) && required.length > 0;
}

export function buildCommonSchema(extraProperties?: Record<string, unknown>) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      ...(extraProperties ?? {}),
      ...COMMON_OVERRIDE_PROPERTIES,
    },
  } as const;
}

export function buildBrowserToolSchema(browserAction: BrowserAction) {
  const raw = BROWSER_ACTION_INPUT_SCHEMAS[browserAction] ?? (STRICT_EMPTY_OBJECT_SCHEMA as Record<string, unknown>);
  const paramsSchema = cloneSchema(raw);
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      params: paramsSchema,
      ...COMMON_OVERRIDE_PROPERTIES,
    },
    ...(hasRequiredParams(raw) ? { required: ["params"] } : {}),
  } as const;
}
