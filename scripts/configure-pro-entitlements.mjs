import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkStripeSetup } from "./check-stripe-setup.mjs";
import { checkStripeSandbox } from "./check-stripe-sandbox.mjs";

// Operator-only provisioning. Does not enable Checkout or create a payment.
export async function configureProEntitlements(
  env,
  enabled,
  dependencies = {}
) {
  if (typeof enabled !== "boolean")
    throw new Error("PRO_SETUP_CONFIGURATION_INVALID");
  let database;
  try {
    database = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
  } catch {
    throw new Error("PRO_SETUP_CONFIGURATION_INVALID");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(database.hostname);
  const live = env.STRIPE_BILLING_MODE === "live";
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (
    !key ||
    database.username ||
    database.password ||
    database.search ||
    database.hash ||
    database.pathname !== "/" ||
    (live
      ? database.origin !== "https://api.yokkai-collec.com"
      : !local || !["http:", "https:"].includes(database.protocol))
  )
    throw new Error("PRO_SETUP_CONFIGURATION_INVALID");
  // Provider readback verifies account, exact price, currency and monthly period.
  // Both billing flags must still be closed during this preflight.
  await (
    live
      ? dependencies.checkLive || checkStripeSetup
      : dependencies.checkTest || checkStripeSandbox
  )(env);
  const db = (dependencies.createClient || createClient)(database.origin, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { error } = await db.rpc("billing_set_entitlement_scope", {
    p_scope: `${live ? "live" : "test"}:${env.STRIPE_ACCOUNT_ID}:${env.STRIPE_PRO_PRICE_ID}`,
    p_enabled: enabled
  });
  if (error) throw new Error("PRO_SETUP_STORAGE_UNAVAILABLE");
  return {
    configured: true,
    mode: live ? "live" : "test",
    benefitsEnabled: enabled,
    purchasesEnabled: false
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1 || !["--enable", "--disable"].includes(args[0]))
      throw new Error("PRO_SETUP_CONFIGURATION_INVALID");
    console.log(
      JSON.stringify(
        await configureProEntitlements(process.env, args[0] === "--enable")
      )
    );
  } catch (error) {
    console.error(
      error instanceof Error &&
        /^(PRO_SETUP|STRIPE_SETUP|STRIPE_SANDBOX)_[A-Z_]+$/.test(error.message)
        ? error.message
        : "PRO_SETUP_FAILED"
    );
    process.exitCode = 1;
  }
}
