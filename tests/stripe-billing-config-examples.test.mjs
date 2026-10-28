import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path =>
  readFileSync(new URL("../" + path, import.meta.url), "utf8");
const env = text =>
  Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter(line => /^[A-Z_]+=/.test(line))
      .map(line => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );

test("configuration examples keep purchases closed, live prices out of local tests and all secrets unset", () => {
  const local = env(read(".env.billing.example"));
  assert.equal(local.STRIPE_BILLING_ENABLED, "false");
  assert.equal(local.STRIPE_CHECKOUT_ENABLED, "false");
  assert.equal(local.STRIPE_BILLING_MODE, "test");
  assert.equal(local.STRIPE_PRO_PRICE_ID, "");
  assert.equal(local.STRIPE_ACCOUNT_ID, "");
  const doc = read("docs/stripe-production-foundation.md");
  const block = doc.match(/```dotenv\r?\n([\s\S]*?)```/)?.[1];
  assert.ok(block);
  const production = env(block);
  assert.equal(production.STRIPE_BILLING_ENABLED, "false");
  assert.equal(production.STRIPE_CHECKOUT_ENABLED, "false");
  assert.equal(production.STRIPE_BILLING_MODE, "live");
  assert.match(production.STRIPE_PRO_PRICE_ID, /^price_[A-Za-z0-9]+$/);
  assert.match(production.STRIPE_ACCOUNT_ID, /^acct_[A-Za-z0-9]+$/);
  for (const key of [
    "STRIPE_SECRET_KEY",
    "STRIPE_PRO_WEBHOOK_SECRET",
    "STRIPE_RECONCILIATION_SECRET",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY"
  ]) {
    assert.ok(!local[key]);
    assert.ok(!production[key]);
  }
  assert.ok(
    read(".env.billing.example").includes(
      "# STRIPE_PRO_PRICE_ID=" + production.STRIPE_PRO_PRICE_ID
    )
  );
  assert.ok(
    read(".env.billing.example").includes(
      "# STRIPE_ACCOUNT_ID=" + production.STRIPE_ACCOUNT_ID
    )
  );
});

test("Sandbox preparation keeps its supplied price separate from live configuration and credentials", () => {
  const doc = read("docs/stripe-production-foundation.md");
  const section = doc.split("### Tarif Sandbox fourni")[1];
  assert.ok(section);
  const block = section.match(/```dotenv\r?\n([\s\S]*?)```/)?.[1];
  assert.ok(block);
  const sandbox = env(block);
  assert.equal(sandbox.STRIPE_BILLING_ENABLED, "false");
  assert.equal(sandbox.STRIPE_CHECKOUT_ENABLED, "false");
  assert.equal(sandbox.STRIPE_BILLING_MODE, "test");
  assert.equal(sandbox.STRIPE_PRO_PRICE_ID, "price_1URcyIIQHbfFctSIkiBvXgIo");
  assert.equal(sandbox.STRIPE_ACCOUNT_ID, "acct_1UQSisIQHbfFctSI");
  assert.notEqual(
    sandbox.STRIPE_ACCOUNT_ID,
    env(doc.match(/```dotenv\r?\n([\s\S]*?)```/)[1]).STRIPE_ACCOUNT_ID
  );
  for (const key of [
    "STRIPE_SECRET_KEY",
    "STRIPE_PRO_WEBHOOK_SECRET",
    "STRIPE_RECONCILIATION_SECRET"
  ]) {
    assert.equal(sandbox[key], "");
  }
  const productionBlock = doc.match(/```dotenv\r?\n([\s\S]*?)```/)?.[1];
  assert.ok(productionBlock);
  const production = env(productionBlock);
  assert.equal(
    production.STRIPE_PRO_PRICE_ID,
    "price_1URdBZIuXkg5OZqmJiQZmOr7"
  );
  assert.notEqual(sandbox.STRIPE_PRO_PRICE_ID, production.STRIPE_PRO_PRICE_ID);
  assert.ok(
    read(".env.billing.example").includes(
      "# STRIPE_PRO_PRICE_ID=" + sandbox.STRIPE_PRO_PRICE_ID
    )
  );
  assert.ok(
    read(".env.billing.example").includes(
      "# STRIPE_ACCOUNT_ID=" + sandbox.STRIPE_ACCOUNT_ID
    )
  );
});
