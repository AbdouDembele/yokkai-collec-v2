import "server-only";
import Stripe from "stripe";
import { billingConfig, BillingError, type BillingConfig } from "./config";
import { billingStore, type BillingStore } from "./store";

const idOf = (value: string | { id: string } | null) =>
  typeof value === "string" ? value : value?.id;

// Only server-owned customer mappings are used. Never erase the mapping after
// an uncertain provider response: the committed deletion fence is resumable.
export async function cancelAccountBilling(
  userId: string,
  config: BillingConfig,
  stripe: Stripe,
  store: BillingStore
) {
  const account = await store.claimDeletion(userId);
  if (!account) return;
  const deadline = Date.now() + 45000;
  const budget = () => {
    if (Date.now() >= deadline)
      throw new BillingError("BILLING_REVIEW_REQUIRED");
  };
  try {
    if ((await stripe.accounts.retrieve(null)).id !== config.account)
      throw new BillingError("BILLING_ACCOUNT_MISMATCH");
    if (
      (!account.stripe_customer_id && account.customer_started_at) ||
      (!account.checkout_id && account.checkout_started_at)
    )
      throw new BillingError("BILLING_REVIEW_REQUIRED");
    if (account.stripe_customer_id) {
      const customer = account.stripe_customer_id;
      const subscriptions = new Set<string>();
      const closeSession = async (session: Stripe.Checkout.Session) => {
        budget();
        if (
          session.livemode !== config.live ||
          idOf(session.customer) !== customer ||
          session.client_reference_id !== userId ||
          session.mode !== "subscription"
        )
          throw new BillingError("BILLING_REVIEW_REQUIRED");
        if (session.status === "open") {
          try {
            await stripe.checkout.sessions.expire(session.id);
          } catch {
            // Payment may have completed concurrently; only a verified terminal
            // session can proceed to subscription cancellation.
          }
          budget();
          session = await stripe.checkout.sessions.retrieve(session.id);
          if (
            session.livemode !== config.live ||
            idOf(session.customer) !== customer ||
            session.client_reference_id !== userId ||
            session.mode !== "subscription"
          )
            throw new BillingError("BILLING_REVIEW_REQUIRED");
        }
        if (!["expired", "complete"].includes(session.status ?? ""))
          throw new BillingError("BILLING_REVIEW_REQUIRED");
        const subscription = idOf(session.subscription);
        if (session.status === "complete" && !subscription)
          throw new BillingError("BILLING_REVIEW_REQUIRED");
        if (subscription) subscriptions.add(subscription);
      };
      if (account.checkout_id)
        await closeSession(
          await stripe.checkout.sessions.retrieve(account.checkout_id)
        );
      budget();
      const sessions = await stripe.checkout.sessions.list({
        customer,
        status: "open",
        limit: 100
      });
      if (sessions.has_more) throw new BillingError("BILLING_REVIEW_REQUIRED");
      for (const session of sessions.data) await closeSession(session);
      budget();
      const listed = await stripe.subscriptions.list({
        customer,
        status: "all",
        limit: 100
      });
      if (listed.has_more) throw new BillingError("BILLING_REVIEW_REQUIRED");
      for (const sub of listed.data) subscriptions.add(sub.id);
      for (const id of subscriptions) {
        budget();
        const sub = await stripe.subscriptions.retrieve(id);
        if (
          sub.livemode !== config.live ||
          idOf(sub.customer) !== customer ||
          sub.items.has_more ||
          sub.items.data.length !== 1 ||
          sub.items.data[0].price.id !== config.price ||
          sub.items.data[0].quantity !== 1
        )
          throw new BillingError("BILLING_REVIEW_REQUIRED");
        if (!["canceled", "incomplete_expired"].includes(sub.status)) {
          budget();
          const canceled = await stripe.subscriptions.cancel(id, {
            invoice_now: false,
            prorate: false
          });
          if (
            canceled.id !== id ||
            canceled.status !== "canceled" ||
            canceled.livemode !== config.live ||
            idOf(canceled.customer) !== customer
          )
            throw new BillingError("BILLING_REVIEW_REQUIRED");
        }
      }
    }
    budget();
    await store.confirmDeletion(account);
  } finally {
    await store.release(account);
  }
}

export async function cancelDeletedAccountBilling(userId: string) {
  // Closing new sales must not disable cancellation for existing subscribers.
  // All environment, account, mode, origin and price-scope checks still apply.
  const config = billingConfig({
    ...process.env,
    STRIPE_BILLING_ENABLED: "true",
    STRIPE_CHECKOUT_ENABLED: "false"
  });
  return cancelAccountBilling(
    userId,
    config,
    new Stripe(config.secret, {
      apiVersion: Stripe.API_VERSION,
      maxNetworkRetries: 0,
      timeout: 5000
    }),
    billingStore(config)
  );
}
