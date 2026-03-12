export function readString(
  raw: Record<string, unknown>,
  key: string,
  opts?: { required?: boolean },
): string | undefined {
  const value = raw[key];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  if (opts?.required) {
    throw new Error(`Missing required string parameter: ${key}`);
  }
  return undefined;
}

export function readBoolean(raw: Record<string, unknown>, key: string): boolean | undefined {
  const value = raw[key];
  return typeof value === "boolean" ? value : undefined;
}

export function readNumber(raw: Record<string, unknown>, key: string): number | undefined {
  const value = raw[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function readObject(raw: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = raw[key];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}
