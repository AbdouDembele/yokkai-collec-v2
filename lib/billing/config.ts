import "server-only";

export class BillingError extends Error {
  constructor(
    public code: string,
    public status = 503
  ) {
    super(code);
  }
}

export function billingConfig(
  env: Record<string, string | undefined> = process.env
) {
  if (env.STRIPE_BILLING_ENABLED !== "true")
    throw new BillingError("BILLING_DISABLED", 404);
  const live = env.STRIPE_BILLING_MODE === "live";
  if (!live && env.STRIPE_BILLING_MODE !== "test")
    throw new BillingError("BILLING_CONFIGURATION");
  let site: URL, database: URL;
  try {
    site = new URL(env.NEXT_PUBLIC_SITE_URL!);
    database = new URL(env.NEXT_PUBLIC_SUPABASE_URL!);
  } catch {
    throw new BillingError("BILLING_CONFIGURATION");
  }
  const loopback = (url: URL) =>
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    site.username ||
    site.password ||
    database.username ||
    database.password ||
    site.pathname !== "/" ||
    site.search ||
    site.hash ||
    (live
      ? env.NODE_ENV !== "production" ||
        site.origin !== "https://yokkai-collec.com" ||
        database.protocol !== "https:" ||
        loopback(database)
      : env.NODE_ENV !== "development" ||
        !loopback(site) ||
        !loopback(database) ||
        !["http:", "https:"].includes(site.protocol) ||
        !["http:", "https:"].includes(database.protocol))
  ) {
    throw new BillingError("BILLING_CONFIGURATION");
  }
  const secret = env.STRIPE_SECRET_KEY ?? "";
  const price = env.STRIPE_PRO_PRICE_ID ?? "";
  const account = env.STRIPE_ACCOUNT_ID ?? "";
  const webhookSecret = env.STRIPE_PRO_WEBHOOK_SECRET ?? "";
  const serviceKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (
    !(
      live ? /^(?:sk|rk)_live_[A-Za-z0-9]+$/ : /^(?:sk|rk)_test_[A-Za-z0-9]+$/
    ).test(secret) ||
    !/^price_[A-Za-z0-9]+$/.test(price) ||
    !/^acct_[A-Za-z0-9]+$/.test(account) ||
    !/^whsec_[A-Za-z0-9]+$/.test(webhookSecret) ||
    !serviceKey
  )
    throw new BillingError("BILLING_CONFIGURATION");
  return {
    live,
    secret,
    price,
    account,
    webhookSecret,
    serviceKey,
    database: database.origin,
    origin: site.origin,
    scope: `${live ? "live" : "test"}:${account}:${price}`,
    checkoutEnabled: env.STRIPE_CHECKOUT_ENABLED === "true"
  };
}

export type BillingConfig = ReturnType<typeof billingConfig>;
