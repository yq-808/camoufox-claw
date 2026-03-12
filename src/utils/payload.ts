import { MAX_SERIALIZED_PAYLOAD_CHARS, MAX_TEXT_FIELD_CHARS, TRUNCATION_SUFFIX } from "../constants/limits";

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  const keep = Math.max(256, maxChars - TRUNCATION_SUFFIX.length);
  return `${value.slice(0, keep)}${TRUNCATION_SUFFIX}`;
}

function summarizeImagePayload(item: Record<string, unknown>): Record<string, unknown> {
  const mimeType = typeof item.mimeType === "string" && item.mimeType ? item.mimeType : "image";
  const data = typeof item.data === "string" ? item.data : "";
  return {
    type: "text",
    text: `[${mimeType} omitted from tool output; removed ${data.length} base64 chars]`,
  };
}

export function sanitizePayload(value: unknown): unknown {
  if (typeof value === "string") {
    return truncateText(value, MAX_TEXT_FIELD_CHARS);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizePayload(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  if (record.type === "image" && typeof record.data === "string") {
    return summarizeImagePayload(record);
  }

  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (key === "details") {
      continue;
    }
    next[key] = sanitizePayload(entry);
  }
  return next;
}

export function serializePayload(payload: unknown): string {
  const text = JSON.stringify(payload, null, 2);
  return truncateText(text, MAX_SERIALIZED_PAYLOAD_CHARS);
}
