import type { AccountUsageSnapshot } from "./brain";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : NaN;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function normalizeAccountUsageSnapshot(value: unknown): AccountUsageSnapshot | null {
  const parsed = asRecord(value);
  const used = numberValue(parsed.used ?? parsed.requests ?? parsed.usage_requests);
  const limit = numberValue(parsed.limit ?? parsed.requestLimit ?? parsed.request_limit);

  if (!Number.isFinite(used) || !Number.isFinite(limit)) {
    return null;
  }

  const label = stringValue(parsed.label).trim();
  const resetAt =
    stringValue(parsed.resetAt) ||
    stringValue(parsed.reset_at) ||
    stringValue(parsed.periodEnd) ||
    stringValue(parsed.period_end) ||
    undefined;
  const updatedAt = stringValue(parsed.updatedAt) || stringValue(parsed.updated_at) || undefined;

  return {
    label: label || "Daily requests",
    used,
    limit,
    resetAt,
    updatedAt
  };
}
