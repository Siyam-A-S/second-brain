const assert = require("node:assert/strict");
const test = require("node:test");

const { normalizeAccountUsageSnapshot } = require("../../dist/shared/accountUsage.js");

test("normalizes desktop account usage fields", () => {
  assert.deepEqual(
    normalizeAccountUsageSnapshot({
      label: "AI usage",
      used: 42,
      limit: 250,
      resetAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-13T12:00:00.000Z"
    }),
    {
      label: "AI usage",
      used: 42,
      limit: 250,
      resetAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-13T12:00:00.000Z"
    }
  );
});

test("normalizes server handoff request-limit fields", () => {
  assert.deepEqual(
    normalizeAccountUsageSnapshot({
      requests: "17",
      requestLimit: "1000",
      periodEnd: "2026-07-14T00:00:00.000Z"
    }),
    {
      label: "Daily requests",
      used: 17,
      limit: 1000,
      resetAt: "2026-07-14T00:00:00.000Z",
      updatedAt: undefined
    }
  );
});

test("normalizes snake-case RPC usage fields", () => {
  assert.deepEqual(
    normalizeAccountUsageSnapshot({
      usage_requests: 250,
      request_limit: 250,
      reset_at: "2026-07-14T00:00:00.000Z",
      updated_at: "2026-07-13T12:01:00.000Z"
    }),
    {
      label: "Daily requests",
      used: 250,
      limit: 250,
      resetAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-13T12:01:00.000Z"
    }
  );
});

test("rejects missing and malformed account usage", () => {
  assert.equal(normalizeAccountUsageSnapshot(null), null);
  assert.equal(normalizeAccountUsageSnapshot({ used: 1 }), null);
  assert.equal(normalizeAccountUsageSnapshot({ requests: "many", requestLimit: 250 }), null);
});
