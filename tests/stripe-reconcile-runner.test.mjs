import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { reconcileStripe } from "../scripts/reconcile-stripe.mjs";

const env = {
  NODE_ENV: "production",
  STRIPE_BILLING_MODE: "live",
  STRIPE_BILLING_ENABLED: "true",
  NEXT_PUBLIC_SITE_URL: "https://yokkai-collec.com",
  STRIPE_RECONCILIATION_SECRET: randomBytes(32).toString("hex")
};
const cursor = "11111111-1111-1111-1111-111111111111";
const reply = (checked, failed = 0, next = null) =>
  new Response(JSON.stringify({ checked, failed, next }), {
    status: failed ? 503 : 200
  });

test("closed billing skips reconciliation without reading secrets or making requests", async () => {
  assert.deepEqual(
    await reconcileStripe(
      { STRIPE_BILLING_ENABLED: "false" },
      { fetchImpl: () => assert.fail("network") }
    ),
    { skipped: true, reason: "billing_disabled" }
  );
});
test("runner rejects wrong environments, destinations, flags and secrets before network", async () => {
  for (const change of [
    { NODE_ENV: "development" },
    { STRIPE_BILLING_MODE: "test" },
    { STRIPE_BILLING_ENABLED: undefined },
    { NEXT_PUBLIC_SITE_URL: "https://example.com" },
    { STRIPE_RECONCILIATION_SECRET: "short" }
  ]) {
    await assert.rejects(
      reconcileStripe(
        { ...env, ...change },
        { fetchImpl: () => assert.fail("network") }
      ),
      /CONFIGURATION_INVALID/
    );
  }
});
test("every cursor is drained with server-only auth and redirects disabled", async () => {
  const calls = [];
  const result = await reconcileStripe(env, {
    fetchImpl: async (url, options) => {
      calls.push(url);
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "error");
      assert.equal(
        options.headers.Authorization,
        `Bearer ${env.STRIPE_RECONCILIATION_SECRET}`
      );
      assert.ok(options.signal instanceof AbortSignal);
      return calls.length === 1 ? reply(100, 0, cursor) : reply(4);
    }
  });
  assert.equal(new URL(calls[0]).origin, "https://yokkai-collec.com");
  assert.equal(new URL(calls[1]).searchParams.get("after"), cursor);
  assert.deepEqual(result, {
    skipped: false,
    checked: 104,
    pages: 2,
    passes: 1,
    failed: 0
  });
});
test("503 pages still advance, then a fresh full pass retries earlier failures", async () => {
  const pages = [
    reply(100, 1, cursor),
    reply(3),
    reply(100, 0, cursor),
    reply(3)
  ];
  const cursors = [];
  const result = await reconcileStripe(env, {
    fetchImpl: async url => {
      cursors.push(new URL(url).searchParams.get("after"));
      return pages.shift();
    }
  });
  assert.equal(cursors[0], cursors[2]);
  assert.equal(cursors[1], cursor);
  assert.equal(cursors[3], cursor);
  assert.equal(result.passes, 2);
  assert.equal(result.checked, 206);
});
test("unresolved failures make the scheduled task fail after a bounded retry", async () => {
  let calls = 0;
  await assert.rejects(
    reconcileStripe(env, {
      fetchImpl: async () => {
        calls++;
        return reply(1, 1);
      }
    }),
    /ACCOUNTS_FAILED/
  );
  assert.equal(calls, 2);
});
test("invalid counts, error envelopes and cursor payloads are rejected", async () => {
  for (const body of [
    { code: "BILLING_DISABLED" },
    { checked: -1, failed: 0, next: null },
    { checked: 1, failed: 2, next: null },
    { checked: 1, failed: 0, next: "https://example.com" },
    { checked: 1, failed: 0 }
  ]) {
    await assert.rejects(
      reconcileStripe(env, {
        fetchImpl: async () => new Response(JSON.stringify(body))
      }),
      /RESPONSE_INVALID/
    );
  }
});
test("cursor loops and zero-progress pages fail instead of skipping accounts", async () => {
  for (const checked of [0, 1]) {
    await assert.rejects(
      reconcileStripe(env, {
        fetchImpl: async () => reply(checked, 0, cursor)
      }),
      /CURSOR_INVALID/
    );
  }
});
test("network and HTTP failures are sanitized and never include credentials", async () => {
  for (const fetchImpl of [
    async () => {
      throw Error(env.STRIPE_RECONCILIATION_SECRET);
    },
    async () => new Response("private", { status: 401 })
  ]) {
    await assert.rejects(
      reconcileStripe(env, { fetchImpl }),
      error =>
        error.message === "STRIPE_RECONCILE_REQUEST_FAILED" &&
        !error.message.includes(env.STRIPE_RECONCILIATION_SECRET)
    );
  }
});
test("a total deadline stops a long cursor chain before the next request", async () => {
  let calls = 0,
    ticks = 0;
  await assert.rejects(
    reconcileStripe(env, {
      now: () => (ticks++ === 0 ? 0 : 240001),
      fetchImpl: () => {
        calls++;
        assert.fail("network");
      }
    }),
    /DEADLINE_EXCEEDED/
  );
  assert.equal(calls, 0);
});
