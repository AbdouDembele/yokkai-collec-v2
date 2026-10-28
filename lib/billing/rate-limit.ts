import "server-only";
import { createClient } from "@supabase/supabase-js";
import { billingConfig, BillingError } from "./config";

export class BillingRateLimitError extends BillingError {
  constructor(public retryAfterSeconds: number) {
    super("BILLING_RATE_LIMITED", 429);
  }
}

export async function consumeBillingRequest(
  userId: string,
  action: "checkout" | "portal" | "status"
) {
  const config = billingConfig();
  const db = createClient(config.database, config.serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
  const { data, error } = await db.rpc("billing_consume_request", {
    p_user: userId,
    p_scope: config.scope,
    p_action: action
  });
  // A missing migration or an unavailable quota store must not bypass the cap.
  if (error || !Number.isSafeInteger(data) || data < 0 || data > 600)
    throw new BillingError("BILLING_STORAGE_UNAVAILABLE");
  if (data > 0) throw new BillingRateLimitError(data);
}
