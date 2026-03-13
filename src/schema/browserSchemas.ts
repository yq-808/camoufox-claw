import type { BrowserAction } from "../constants/actions";

export const BROWSER_ACTION_INPUT_SCHEMAS: Partial<Record<BrowserAction, Record<string, unknown>>> = {
  browser_click: {
    type: "object",
    properties: {
      element: {
        type: "string",
        description: "Human-readable element description used to obtain permission to interact with the element",
      },
      ref: { type: "string", description: "Exact target element reference from the page snapshot" },
      doubleClick: { type: "boolean", description: "Whether to perform a double click instead of a single click" },
      button: { type: "string", enum: ["left", "right", "middle"], description: "Button to click, defaults to left" },
      modifiers: {
        type: "array",
        items: { type: "string", enum: ["Alt", "Control", "ControlOrMeta", "Meta", "Shift"] },
        description: "Modifier keys to press",
      },
    },
    required: ["element", "ref"],
    additionalProperties: false,
  },
  browser_close: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  browser_drag: {
    type: "object",
    properties: {
      startElement: {
        type: "string",
        description: "Human-readable source element description used to obtain the permission to interact with the element",
      },
      startRef: { type: "string", description: "Exact source element reference from the page snapshot" },
      endElement: {
        type: "string",
        description: "Human-readable target element description used to obtain the permission to interact with the element",
      },
      endRef: { type: "string", description: "Exact target element reference from the page snapshot" },
    },
    required: ["startElement", "startRef", "endElement", "endRef"],
    additionalProperties: false,
  },
  browser_file_upload: {
    type: "object",
    properties: {
      paths: {
        type: "array",
        items: { type: "string" },
        description: "The absolute paths to the files to upload. Can be single or multiple files.",
      },
    },
    additionalProperties: false,
  },
  browser_fill_form: {
    type: "object",
    properties: {
      fields: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Human-readable field name" },
            type: { type: "string", enum: ["textbox", "checkbox", "radio", "combobox", "slider"] },
            ref: { type: "string", description: "Exact target field reference from the page snapshot" },
            value: { type: "string", description: "Value to fill in the field." },
          },
          required: ["name", "type", "ref", "value"],
          additionalProperties: false,
        },
        description: "Fields to fill in",
      },
    },
    required: ["fields"],
    additionalProperties: false,
  },
  browser_generate_locator: {
    type: "object",
    properties: {
      element: {
        type: "string",
        description: "Human-readable element description used to obtain permission to interact with the element",
      },
      ref: { type: "string", description: "Exact target element reference from the page snapshot" },
    },
    required: ["element", "ref"],
    additionalProperties: false,
  },
  browser_handle_dialog: {
    type: "object",
    properties: {
      accept: { type: "boolean", description: "Whether to accept the dialog." },
      promptText: { type: "string", description: "Prompt text for prompt dialogs." },
    },
    required: ["accept"],
    additionalProperties: false,
  },
  browser_hover: {
    type: "object",
    properties: {
      element: {
        type: "string",
        description: "Human-readable element description used to obtain permission to interact with the element",
      },
      ref: { type: "string", description: "Exact target element reference from the page snapshot" },
    },
    required: ["element", "ref"],
    additionalProperties: false,
  },
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
  browser_run_code: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description: "JavaScript function string to execute with Playwright page, e.g. async (page) => { ... }",
      },
    },
    required: ["code"],
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
