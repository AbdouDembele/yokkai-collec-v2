import "server-only";
import { billingConfig } from "./config";

export function billingSandboxEnabled(
  env: Record<string, string | undefined> = process.env
) {
  if (env.NODE_ENV !== "development" || env.STRIPE_SANDBOX_PREVIEW !== "true")
    return false;
  try {
    const config = billingConfig(env);
    return !config.live && config.checkoutEnabled;
  } catch {
    return false;
  }
}
