import { readString } from "./readers";

export function validateClickToolArgs(rawToolArgs: Record<string, unknown>): void {
  const element = readString(rawToolArgs, "element");
  const ref = readString(rawToolArgs, "ref");
  const locator = readString(rawToolArgs, "locator")
    ?? readString(rawToolArgs, "selector")
    ?? readString(rawToolArgs, "target");
  if (element && ref) {
    return;
  }
  const missing = [!element ? "element" : "", !ref ? "ref" : ""].filter(Boolean).join(", ");
  const locatorHint = locator
    ? " `locator`/`selector` is not accepted by this click schema on the current backend."
    : "";
  throw new Error(
    `[camoufox-claw] retryable=true: click requires params.element + params.ref from the latest snapshot; missing ${missing}.${locatorHint} `
    + "Please call `browser_snapshot` and retry `browser_click` with both fields.",
  );
}

function isClickContractError(errorText: string): boolean {
  return /invalid_type/i.test(errorText)
    && (/\"path\":\s*\[\s*\"element\"\s*\]/i.test(errorText)
      || /\"path\":\s*\[\s*\"ref\"\s*\]/i.test(errorText)
      || /Required/i.test(errorText));
}

function isRefNotFoundError(errorText: string): boolean {
  return /Ref\s+e\d+\s+not found/i.test(errorText);
}

function isClickRetryableFailure(errorText: string): boolean {
  return isRefNotFoundError(errorText)
    || /TimeoutError:\s*locator\.click/i.test(errorText)
    || /intercepts pointer events/i.test(errorText)
    || /timed out/i.test(errorText);
}

export function formatToolError(action: string, error: string): string {
  const base = error || "camoufox operation failed";
  if (action === "browser_click" && isClickContractError(base)) {
    return `${base}\n[camoufox-claw] retryable=true: click requires params.element + params.ref. `
      + "Retry with a fresh browser_snapshot and pass both fields.";
  }
  if (action === "browser_click" && isRefNotFoundError(base)) {
    return `${base}\n[camoufox-claw] retryable=true: stale ref detected. `
      + "Call browser_snapshot first to refresh refs, then retry browser_click with element+ref.";
  }
  if (action === "browser_click" && isClickRetryableFailure(base)) {
    return `${base}\n[camoufox-claw] retryable=true: click was blocked or timed out. `
      + "Refresh browser_snapshot and retry browser_click; if overlay blocks input, dismiss it before clicking.";
  }
  return base;
}

export function extractToolResultErrorText(result: unknown): string | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }
  const record = result as Record<string, unknown>;
  if (record.isError !== true) {
    return undefined;
  }
  const content = record.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item && typeof item === "object") {
        const text = (item as Record<string, unknown>).text;
        if (typeof text === "string" && text.trim().length > 0) {
          return text.trim();
        }
      }
    }
  }
  return JSON.stringify(record);
}
