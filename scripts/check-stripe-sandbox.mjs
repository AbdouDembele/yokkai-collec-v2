import Stripe from "stripe";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Test credentials only; no customers, subscriptions, payments or database writes.
export async function checkStripeSandbox(
  env,
  createStripe = key =>
    new Stripe(key, {
      apiVersion: Stripe.API_VERSION,
      timeout: 10000,
      maxNetworkRetries: 1
    })
) {
  let site;
  try {
    site = new URL(env.NEXT_PUBLIC_SITE_URL);
  } catch {
    throw new Error("STRIPE_SANDBOX_CONFIGURATION_INVALID");
  }
  if (
    env.NODE_ENV !== "development" ||
    !["http:", "https:"].includes(site.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(site.hostname) ||
    site.pathname !== "/" ||
    site.search ||
    site.hash ||
    site.username ||
    site.password ||
    env.STRIPE_BILLING_ENABLED !== "false" ||
    env.STRIPE_CHECKOUT_ENABLED !== "false" ||
    env.STRIPE_BILLING_MODE !== "test" ||
    !/^(?:sk|rk)_test_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY ?? "") ||
    !/^acct_[A-Za-z0-9]+$/.test(env.STRIPE_ACCOUNT_ID ?? "") ||
    !/^price_[A-Za-z0-9]+$/.test(env.STRIPE_PRO_PRICE_ID ?? "")
  )
    throw new Error("STRIPE_SANDBOX_CONFIGURATION_INVALID");

  const stripe = createStripe(env.STRIPE_SECRET_KEY);
  let account, price;
  try {
    account = await stripe.accounts.retrieve(null);
    price = await stripe.prices.retrieve(env.STRIPE_PRO_PRICE_ID);
  } catch {
    throw new Error("STRIPE_SANDBOX_PROVIDER_UNAVAILABLE");
  }
  if (account?.id !== env.STRIPE_ACCOUNT_ID)
    throw new Error("STRIPE_SANDBOX_ACCOUNT_MISMATCH");
  if (
    price?.id !== env.STRIPE_PRO_PRICE_ID ||
    price.livemode !== false ||
    price.active !== true ||
    price.type !== "recurring" ||
    price.unit_amount !== 499 ||
    price.currency !== "eur" ||
    price.recurring?.interval !== "month" ||
    price.recurring.interval_count !== 1 ||
    price.recurring.usage_type !== "licensed"
  )
    throw new Error("STRIPE_SANDBOX_PRICE_INVALID");

  return {
    verified: true,
    mode: "test",
    account: "matched",
    price: "matched",
    amount: 499,
    currency: "eur",
    interval: "month",
    purchasesEnabled: false
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(JSON.stringify(await checkStripeSandbox(process.env)));
  } catch (error) {
    const code =
      error instanceof Error && /^STRIPE_SANDBOX_[A-Z_]+$/.test(error.message)
        ? error.message
        : "STRIPE_SANDBOX_FAILED";
    console.error(code);
    process.exitCode = 1;
  }
}
