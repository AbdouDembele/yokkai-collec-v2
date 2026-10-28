import assert from "node:assert/strict";
import test from "node:test";
import { checkStripeSandbox } from "../scripts/check-stripe-sandbox.mjs";

const env = Object.freeze({
  NODE_ENV: "development",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  STRIPE_BILLING_ENABLED: "false",
  STRIPE_CHECKOUT_ENABLED: "false",
  STRIPE_BILLING_MODE: "test",
  STRIPE_SECRET_KEY: "rk_test_example",
  STRIPE_ACCOUNT_ID: "acct_example",
  STRIPE_PRO_PRICE_ID: "price_example"
});
const price = {
  id: env.STRIPE_PRO_PRICE_ID,
  livemode: false,
  active: true,
  type: "recurring",
  unit_amount: 499,
  currency: "eur",
  recurring: { interval: "month", interval_count: 1, usage_type: "licensed" }
};
const client =
  (account = env.STRIPE_ACCOUNT_ID, value = price) =>
  () => ({
    accounts: { retrieve: async () => ({ id: account }) },
    prices: { retrieve: async () => value }
  });

test("Sandbox preflight uses exactly two read operations and returns no credentials or Stripe IDs", async () => {
  const calls = [];
  const result = await checkStripeSandbox(env, key => {
    assert.equal(key, env.STRIPE_SECRET_KEY);
    return {
      accounts: {
        retrieve: async id => {
          calls.push(["account", id]);
          return { id: env.STRIPE_ACCOUNT_ID };
        }
      },
      prices: {
        retrieve: async id => {
          calls.push(["price", id]);
          return price;
        }
      }
    };
  });
  assert.deepEqual(calls, [
    ["account", null],
    ["price", env.STRIPE_PRO_PRICE_ID]
  ]);
  assert.deepEqual(result, {
    verified: true,
    mode: "test",
    account: "matched",
    price: "matched",
    amount: 499,
    currency: "eur",
    interval: "month",
    purchasesEnabled: false
  });
  assert.doesNotMatch(
    JSON.stringify(result),
    /rk_test_|acct_example|price_example/
  );
  assert.equal(env.STRIPE_BILLING_ENABLED, "false");
  assert.equal(env.STRIPE_CHECKOUT_ENABLED, "false");
});

test("Sandbox preflight rejects live and unsafe configuration before constructing Stripe", async () => {
  for (const change of [
    { NODE_ENV: "production" },
    { NODE_ENV: "test" },
    { NEXT_PUBLIC_SITE_URL: "https://yokkai-collec.com" },
    { NEXT_PUBLIC_SITE_URL: "http://localhost.evil.example" },
    { NEXT_PUBLIC_SITE_URL: "file://localhost" },
    { NEXT_PUBLIC_SITE_URL: "http://user:password@localhost" },
    { NEXT_PUBLIC_SITE_URL: "http://localhost/path" },
    { NEXT_PUBLIC_SITE_URL: "http://localhost/?key=value" },
    { NEXT_PUBLIC_SITE_URL: "http://localhost/#fragment" },
    { NEXT_PUBLIC_SITE_URL: undefined },
    { STRIPE_BILLING_ENABLED: "true" },
    { STRIPE_BILLING_ENABLED: undefined },
    { STRIPE_CHECKOUT_ENABLED: "true" },
    { STRIPE_CHECKOUT_ENABLED: undefined },
    { STRIPE_BILLING_MODE: "live" },
    { STRIPE_SECRET_KEY: "rk_live_example" },
    { STRIPE_SECRET_KEY: "sk_live_example" },
    { STRIPE_SECRET_KEY: "pk_test_example" },
    { STRIPE_SECRET_KEY: "sk_org_example" },
    { STRIPE_SECRET_KEY: "rk_test_" },
    { STRIPE_SECRET_KEY: undefined },
    { STRIPE_ACCOUNT_ID: "" },
    { STRIPE_PRO_PRICE_ID: "" }
  ]) {
    await assert.rejects(
      checkStripeSandbox({ ...env, ...change }, () =>
        assert.fail("No Stripe SDK for unsafe configuration")
      ),
      /STRIPE_SANDBOX_CONFIGURATION_INVALID/
    );
  }
});

test("Sandbox preflight accepts test secrets on loopback origins only", async () => {
  for (const site of [
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
    "https://localhost:3000"
  ]) {
    for (const key of ["rk_test_example", "sk_test_example"]) {
      const result = await checkStripeSandbox(
        { ...env, NEXT_PUBLIC_SITE_URL: site, STRIPE_SECRET_KEY: key },
        client()
      );
      assert.equal(result.verified, true);
    }
  }
});

test("Sandbox preflight rejects wrong accounts and live, malformed or incorrect prices", async () => {
  await assert.rejects(
    checkStripeSandbox(env, client("acct_other")),
    /STRIPE_SANDBOX_ACCOUNT_MISMATCH/
  );
  for (const value of [
    null,
    { ...price, id: "price_other" },
    { ...price, livemode: true },
    { ...price, livemode: undefined },
    { ...price, active: false },
    { ...price, type: "one_time" },
    { ...price, unit_amount: 999 },
    { ...price, currency: "usd" },
    { ...price, recurring: null },
    {
      ...price,
      recurring: { interval: "year", interval_count: 1, usage_type: "licensed" }
    },
    {
      ...price,
      recurring: {
        interval: "month",
        interval_count: 2,
        usage_type: "licensed"
      }
    },
    {
      ...price,
      recurring: { interval: "month", interval_count: 1, usage_type: "metered" }
    }
  ]) {
    await assert.rejects(
      checkStripeSandbox(env, client(env.STRIPE_ACCOUNT_ID, value)),
      /STRIPE_SANDBOX_PRICE_INVALID/
    );
  }
});

test("Sandbox preflight redacts provider errors from both read operations", async () => {
  for (const failure of ["account", "price"]) {
    await assert.rejects(
      checkStripeSandbox(env, () => ({
        accounts: {
          retrieve: async () => {
            if (failure === "account")
              throw new Error("rk_test_sensitive_payload");
            return { id: env.STRIPE_ACCOUNT_ID };
          }
        },
        prices: {
          retrieve: async () => {
            throw new Error("rk_test_sensitive_payload");
          }
        }
      })),
      error => {
        assert.equal(error.message, "STRIPE_SANDBOX_PROVIDER_UNAVAILABLE");
        assert.doesNotMatch(error.message, /rk_test_sensitive_payload/);
        return true;
      }
    );
  }
});
