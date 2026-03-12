import type { BrowserAction } from "../constants/actions";

export const BROWSER_SCHEMAS_C: Partial<Record<BrowserAction, Record<string, unknown>>> = {
  browser_snapshot: {
    type: "object",
    properties: {
      filename: { type: "string", description: "Save snapshot to markdown file instead of returning it." },
    },
    additionalProperties: false,
  },
  browser_tabs: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "new", "close", "select"], description: "Operation to perform" },
      index: { type: "number", description: "Tab index for close/select. If omitted for close, current tab is closed." },
    },
    required: ["action"],
    additionalProperties: false,
  },
  browser_take_screenshot: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["png", "jpeg"], default: "png", description: "Image format for screenshot." },
      filename: { type: "string", description: "File name for screenshot output." },
      element: { type: "string", description: "Human-readable element description for permission checks." },
      ref: { type: "string", description: "Exact target element reference from the page snapshot." },
      fullPage: {
        type: "boolean",
        description: "When true, takes a screenshot of full scrollable page (not element screenshot).",
      },
    },
    additionalProperties: false,
  },
  browser_type: {
    type: "object",
    properties: {
      element: { type: "string", description: "Human-readable element description for permission checks." },
      ref: { type: "string", description: "Exact target element reference from the page snapshot" },
      text: { type: "string", description: "Text to type into the element" },
      submit: { type: "boolean", description: "Whether to submit entered text (press Enter after)" },
      slowly: { type: "boolean", description: "Whether to type one character at a time." },
    },
    required: ["element", "ref", "text"],
    additionalProperties: false,
  },
  browser_wait_for: {
    type: "object",
    properties: {
      time: { type: "number", description: "The time to wait in seconds" },
      text: { type: "string", description: "The text to wait for" },
      textGone: { type: "string", description: "The text to wait for to disappear" },
    },
    additionalProperties: false,
  },
  browser_mouse_down: {
    type: "object",
    properties: {
      button: { type: "string", enum: ["left", "right", "middle"], description: "Mouse button to hold down." },
    },
    additionalProperties: false,
  },
  browser_mouse_up: {
    type: "object",
    properties: {
      button: { type: "string", enum: ["left", "right", "middle"], description: "Mouse button to release." },
    },
    additionalProperties: false,
  },
  browser_mouse_wheel: {
    type: "object",
    properties: {
      deltaX: { type: "number", description: "Horizontal scroll amount." },
      deltaY: { type: "number", description: "Vertical scroll amount." },
    },
    additionalProperties: false,
  },
};
