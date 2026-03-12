import type { BrowserAction } from "../constants/actions";

export const BROWSER_SCHEMAS_A: Partial<Record<BrowserAction, Record<string, unknown>>> = {
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
};
