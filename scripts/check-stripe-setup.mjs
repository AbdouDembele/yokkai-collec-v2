import Stripe from "stripe";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Server-side provisioning check only. Never enables billing or creates Stripe objects.
export async function checkStripeSetup(
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
    throw new Error("STRIPE_SETUP_CONFIGURATION_INVALID");
  }
  if (
    env.NODE_ENV !== "production" ||
    site.origin !== "https://yokkai-collec.com" ||
    site.pathname !== "/" ||
    site.search ||
    site.hash ||
    site.username ||
    site.password ||
    env.STRIPE_BILLING_ENABLED !== "false" ||
    env.STRIPE_CHECKOUT_ENABLED !== "false" ||
    env.STRIPE_BILLING_MODE !== "live" ||
    !/^(?:sk|rk)_live_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY ?? "") ||
    !/^acct_[A-Za-z0-9]+$/.test(env.STRIPE_ACCOUNT_ID ?? "") ||
    !/^price_[A-Za-z0-9]+$/.test(env.STRIPE_PRO_PRICE_ID ?? "")
  )
    throw new Error("STRIPE_SETUP_CONFIGURATION_INVALID");
  const stripe = createStripe(env.STRIPE_SECRET_KEY);
  let account, price;
  try {
    account = await stripe.accounts.retrieve(null);
    price = await stripe.prices.retrieve(env.STRIPE_PRO_PRICE_ID);
  } catch {
    throw new Error("STRIPE_SETUP_PROVIDER_UNAVAILABLE");
  }
  if (account.id !== env.STRIPE_ACCOUNT_ID)
    throw new Error("STRIPE_SETUP_ACCOUNT_MISMATCH");
  if (
    price.id !== env.STRIPE_PRO_PRICE_ID ||
    !price.livemode ||
    !price.active ||
    price.type !== "recurring" ||
    price.unit_amount !== 499 ||
    price.currency !== "eur" ||
    price.recurring?.interval !== "month" ||
    price.recurring.interval_count !== 1 ||
    price.recurring.usage_type !== "licensed"
  )
    throw new Error("STRIPE_SETUP_PRICE_INVALID");
  return {
    verified: true,
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
    console.log(JSON.stringify(await checkStripeSetup(process.env)));
  } catch (error) {
    const code =
      error instanceof Error && /^STRIPE_SETUP_[A-Z_]+$/.test(error.message)
        ? error.message
        : "STRIPE_SETUP_FAILED";
    console.error(code);
    process.exitCode = 1;
  }
}
