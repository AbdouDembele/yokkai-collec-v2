import "server-only";
import { createClient } from "@supabase/supabase-js";
import { BillingError, type BillingConfig } from "./config";
import type { SubscriptionState } from "./subscription";

export type BillingAccount = {
  id: string;
  user_id: string;
  scope: string;
  stripe_customer_id: string | null;
  checkout_id: string | null;
  checkout_nonce: string;
  lease_token: string;
  risk_hold: boolean;
  customer_started_at: string | null;
  checkout_started_at: string | null;
};
export function billingStore(config: BillingConfig) {
  const db = createClient(config.database, config.serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await db.rpc(name, args);
    if (error)
      throw new BillingError(
        error.message === "BILLING_BUSY"
          ? "BILLING_BUSY"
          : "BILLING_STORAGE_UNAVAILABLE"
      );
    return data;
  };
  return {
    async claimDeletion(userId: string): Promise<BillingAccount | null> {
      return rpc("billing_claim_deletion", {
        p_user: userId,
        p_scope: config.scope
      });
    },
    async confirmDeletion(account: BillingAccount) {
      await rpc("billing_confirm_deletion", {
        p_id: account.id,
        p_token: account.lease_token
      });
    },
    async claim(userId: string): Promise<BillingAccount> {
      return rpc("billing_claim", { p_user: userId, p_scope: config.scope });
    },
    async release(account: BillingAccount) {
      await rpc("billing_release", {
        p_id: account.id,
        p_token: account.lease_token
      });
    },
    async save(
      account: BillingAccount,
      change: {
        customer?: string;
        checkout?: string;
        rotate?: boolean;
        state?: SubscriptionState;
        event?: string;
        hold?: boolean;
        prepareCustomer?: boolean;
        prepareCheckout?: boolean;
      }
    ) {
      return rpc("billing_save", {
        p_id: account.id,
        p_token: account.lease_token,
        p_customer: change.customer ?? null,
        p_checkout: change.checkout ?? null,
        p_rotate: change.rotate ?? false,
        p_state: change.state ?? null,
        p_event: change.event ?? null,
        p_hold: change.hold ?? false,
        p_prepare_customer: change.prepareCustomer ?? false,
        p_prepare_checkout: change.prepareCheckout ?? false
      });
    },
    async owner(customer: string) {
      const { data, error } = await db
        .from("billing_accounts")
        .select("user_id")
        .eq("scope", config.scope)
        .eq("stripe_customer_id", customer)
        .maybeSingle();
      if (error) throw new BillingError("BILLING_STORAGE_UNAVAILABLE");
      return data?.user_id as string | undefined;
    },
    async processed(event: string) {
      const { data, error } = await db
        .from("billing_webhook_events")
        .select("event_id")
        .eq("scope", config.scope)
        .eq("event_id", event)
        .maybeSingle();
      if (error) throw new BillingError("BILLING_STORAGE_UNAVAILABLE");
      return !!data;
    },
    async reconciliationPage(after: string) {
      const { data, error } = await db
        .from("billing_accounts")
        .select("user_id")
        .eq("scope", config.scope)
        .not("stripe_customer_id", "is", null)
        .gt("user_id", after)
        .order("user_id")
        .limit(100);
      if (error) throw new BillingError("BILLING_STORAGE_UNAVAILABLE");
      return (data ?? []) as { user_id: string }[];
    }
  };
}
export type BillingStore = ReturnType<typeof billingStore>;
