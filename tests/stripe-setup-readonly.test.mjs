import assert from "node:assert/strict";
import test from "node:test";
import { checkStripeSetup } from "../scripts/check-stripe-setup.mjs";

const env = {
  NODE_ENV: "production",
  NEXT_PUBLIC_SITE_URL: "https://yokkai-collec.com",
  STRIPE_BILLING_ENABLED: "false",
  STRIPE_CHECKOUT_ENABLED: "false",
  STRIPE_BILLING_MODE: "live",
  STRIPE_SECRET_KEY: "sk_live_example",
  STRIPE_ACCOUNT_ID: "acct_example",
  STRIPE_PRO_PRICE_ID: "price_example"
};
const price = {
  id: "price_example",
  livemode: true,
  active: true,
  type: "recurring",
  unit_amount: 499,
  currency: "eur",
  recurring: { interval: "month", interval_count: 1, usage_type: "licensed" }
};

test("read-only setup accepts a live restricted key and rejects test, public and organization keys before SDK construction", async () => {
  const checked = await checkStripeSetup(
    { ...env, STRIPE_SECRET_KEY: "rk_live_example" },
    key => {
      assert.equal(key, "rk_live_example");
      return {
        accounts: { retrieve: async () => ({ id: env.STRIPE_ACCOUNT_ID }) },
        prices: { retrieve: async () => price }
      };
    }
  );
  assert.equal(checked.verified, true);
  for (const secret of [
    "rk_test_example",
    "pk_live_example",
    "sk_org_example",
    "rk_org_example",
    "rk_live_"
  ]) {
    await assert.rejects(
      checkStripeSetup({ ...env, STRIPE_SECRET_KEY: secret }, () =>
        assert.fail("No SDK for invalid key")
      ),
      /STRIPE_SETUP_CONFIGURATION_INVALID/
    );
  }
});

test("Stripe setup uses only two read operations and leaves purchases disabled without exposing secrets", async () => {
  const calls = [];
  const result = await checkStripeSetup(env, key => {
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
    ["price", "price_example"]
  ]);
  assert.equal(result.verified, true);
  assert.equal(result.purchasesEnabled, false);
  assert.doesNotMatch(
    JSON.stringify(result),
    /sk_live_|acct_example|price_example/
  );
  assert.equal(env.STRIPE_BILLING_ENABLED, "false");
  assert.equal(env.STRIPE_CHECKOUT_ENABLED, "false");
});

test("setup rejects unsafe configuration before SDK construction, and provider errors stay redacted", async () => {
  for (const change of [
    { NODE_ENV: "development" },
    { NEXT_PUBLIC_SITE_URL: "http://localhost:3000" },
    { STRIPE_BILLING_ENABLED: "true" },
    { STRIPE_BILLING_ENABLED: undefined },
    { STRIPE_CHECKOUT_ENABLED: "true" },
    { STRIPE_BILLING_MODE: "test" },
    { STRIPE_SECRET_KEY: "sk_test_example" },
    { STRIPE_ACCOUNT_ID: "" },
    { STRIPE_PRO_PRICE_ID: "" }
  ]) {
    await assert.rejects(
      checkStripeSetup({ ...env, ...change }, () => {
        assert.fail("Stripe must not be constructed");
      }),
      /STRIPE_SETUP_CONFIGURATION_INVALID/
    );
  }
  await assert.rejects(
    checkStripeSetup(env, () => ({
      accounts: {
        retrieve: async () => {
          throw new Error("sk_live_sensitive_payload");
        }
      }
    })),
    error => {
      assert.equal(error.message, "STRIPE_SETUP_PROVIDER_UNAVAILABLE");
      assert.doesNotMatch(error.message, /sk_live_sensitive/);
      return true;
    }
  );
});

test("setup rejects the wrong account, test-mode price and nonconforming recurring prices", async () => {
  const client = (account, value) => () => ({
    accounts: { retrieve: async () => ({ id: account }) },
    prices: { retrieve: async () => value }
  });
  await assert.rejects(
    checkStripeSetup(env, client("acct_other", price)),
    /STRIPE_SETUP_ACCOUNT_MISMATCH/
  );
  for (const change of [
    { id: "price_other" },
    { livemode: false },
    { active: false },
    { unit_amount: 1 },
    { currency: "usd" },
    { type: "one_time" },
    { recurring: null },
    {
      recurring: { interval: "year", interval_count: 1, usage_type: "licensed" }
    },
    {
      recurring: {
        interval: "month",
        interval_count: 2,
        usage_type: "licensed"
      }
    },
    {
      recurring: { interval: "month", interval_count: 1, usage_type: "metered" }
    }
  ]) {
    await assert.rejects(
      checkStripeSetup(
        env,
        client(env.STRIPE_ACCOUNT_ID, { ...price, ...change })
      ),
      /STRIPE_SETUP_PRICE_INVALID/
    );
  }
});
