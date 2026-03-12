import type { BrowserAction } from "../constants/actions";

export const BROWSER_SCHEMAS_B: Partial<Record<BrowserAction, Record<string, unknown>>> = {
  browser_mouse_click_xy: {
    type: "object",
    properties: {
      element: { type: "string", description: "Human-readable element description for permission checks" },
      x: { type: "number", description: "X coordinate" },
      y: { type: "number", description: "Y coordinate" },
    },
    required: ["element", "x", "y"],
    additionalProperties: false,
  },
  browser_mouse_drag_xy: {
    type: "object",
    properties: {
      element: { type: "string", description: "Human-readable element description for permission checks" },
      startX: { type: "number", description: "Start X coordinate" },
      startY: { type: "number", description: "Start Y coordinate" },
      endX: { type: "number", description: "End X coordinate" },
      endY: { type: "number", description: "End Y coordinate" },
    },
    required: ["element", "startX", "startY", "endX", "endY"],
    additionalProperties: false,
  },
  browser_mouse_move_xy: {
    type: "object",
    properties: {
      element: { type: "string", description: "Human-readable element description for permission checks" },
      x: { type: "number", description: "X coordinate" },
      y: { type: "number", description: "Y coordinate" },
    },
    required: ["element", "x", "y"],
    additionalProperties: false,
  },
  browser_navigate: {
    type: "object",
    properties: { url: { type: "string", description: "The URL to navigate to" } },
    required: ["url"],
    additionalProperties: false,
  },
  browser_navigate_back: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  browser_press_key: {
    type: "object",
    properties: {
      key: {
        type: "string",
        description: "Name of the key to press or a character to generate, such as ArrowLeft or a",
      },
    },
    required: ["key"],
    additionalProperties: false,
  },
  browser_resize: {
    type: "object",
    properties: {
      width: { type: "number", description: "Width of the browser window" },
      height: { type: "number", description: "Height of the browser window" },
    },
    required: ["width", "height"],
    additionalProperties: false,
  },
  browser_select_option: {
    type: "object",
    properties: {
      element: { type: "string", description: "Human-readable element description for permission checks" },
      ref: { type: "string", description: "Exact target element reference from the page snapshot" },
      values: {
        type: "array",
        items: { type: "string" },
        description: "Array of values to select in the dropdown.",
      },
    },
    required: ["element", "ref", "values"],
    additionalProperties: false,
  },
};
