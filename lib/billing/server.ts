import "server-only";
import Stripe from "stripe";
import { billingConfig, BillingError, type BillingConfig } from "./config";
import { billingStore, type BillingStore, type BillingAccount } from "./store";
import { logReconciliationFailure } from "./observability";
import {
  BASIC_STATE,
  BILLING_EVENTS,
  subscriptionState,
  stripeDestination,
  validateProPrice
} from "./subscription";

// Explicit dependencies let tests cover the actual orchestration without Stripe or a remote DB.
export function billingService(
  config: BillingConfig,
  stripe: Stripe,
  store: BillingStore
) {
  async function verifyAccount() {
    if ((await stripe.accounts.retrieve(null)).id !== config.account)
      throw new BillingError("BILLING_ACCOUNT_MISMATCH");
  }
  async function locked<T>(
    userId: string,
    operation: (account: BillingAccount) => Promise<T>
  ) {
    const account = await store.claim(userId);
    try {
      return await operation(account);
    } finally {
      await store.release(account);
    }
  }
  async function current(account: BillingAccount) {
    if (!account.stripe_customer_id)
      return {
        state: { ...BASIC_STATE },
        exists: false,
        closed: new Set<string>()
      };
    const list = await stripe.subscriptions.list({
      customer: account.stripe_customer_id,
      status: "all",
      limit: 100,
      expand: ["data.latest_invoice"]
    });
    if (
      list.data.some(
        sub =>
          (typeof sub.customer === "string"
            ? sub.customer
            : sub.customer.id) !== account.stripe_customer_id
      )
    )
      throw new BillingError("BILLING_REVIEW_REQUIRED");
    const state = subscriptionState(list, config.price, config.live);
    if (account.risk_hold) state.active = false;
    return {
      state,
      exists: list.data.some(
        sub => !["canceled", "incomplete_expired"].includes(sub.status)
      ),
      closed: new Set(
        list.data
          .filter(sub =>
            ["canceled", "incomplete_expired"].includes(sub.status)
          )
          .map(sub => sub.id)
      )
    };
  }
  return {
    async checkout(userId: string) {
      if (!config.checkoutEnabled)
        throw new BillingError("BILLING_CHECKOUT_CLOSED");
      await verifyAccount();
      validateProPrice(await stripe.prices.retrieve(config.price), config.live);
      return locked(userId, async account => {
        if (account.risk_hold)
          throw new BillingError("BILLING_REVIEW_REQUIRED");
        if (!account.stripe_customer_id) {
          if (
            account.customer_started_at &&
            Date.parse(account.customer_started_at) < Date.now() - 23 * 3600000
          )
            throw new BillingError("BILLING_REVIEW_REQUIRED");
          await store.save(account, { prepareCustomer: true });
          const customer = await stripe.customers.create(
            { metadata: { yokkai_user_id: userId } },
            { idempotencyKey: `yokkai-customer:${account.id}` }
          );
          if (customer.livemode !== config.live)
            throw new BillingError("BILLING_MODE_MISMATCH");
          await store.save(account, { customer: customer.id });
          account.stripe_customer_id = customer.id;
        }
        const existing = await current(account);
        if (existing.exists) throw new BillingError("BILLING_USE_PORTAL", 409);
        let nonce = account.checkout_nonce;
        if (account.checkout_id) {
          const pending = await stripe.checkout.sessions.retrieve(
            account.checkout_id
          );
          if (
            pending.livemode !== config.live ||
            pending.customer !== account.stripe_customer_id ||
            pending.client_reference_id !== userId
          )
            throw new BillingError("BILLING_REVIEW_REQUIRED");
          if (pending.status === "open")
            return stripeDestination(
              pending.url,
              "https://checkout.stripe.com"
            );
          // Completed sessions may not yet appear in list() during webhook processing.
          const pendingSubscription =
            typeof pending.subscription === "string"
              ? pending.subscription
              : pending.subscription?.id;
          if (
            pending.status !== "expired" &&
            !(
              pending.status === "complete" &&
              pendingSubscription &&
              existing.closed.has(pendingSubscription)
            )
          )
            throw new BillingError("BILLING_USE_PORTAL", 409);
          nonce = await store.save(account, { rotate: true });
          account.checkout_started_at = null;
        }
        if (
          account.checkout_started_at &&
          Date.parse(account.checkout_started_at) < Date.now() - 23 * 3600000
        )
          throw new BillingError("BILLING_REVIEW_REQUIRED");
        await store.save(account, { prepareCheckout: true });
        const session = await stripe.checkout.sessions.create(
          {
            mode: "subscription",
            customer: account.stripe_customer_id,
            client_reference_id: userId,
            line_items: [{ price: config.price, quantity: 1 }],
            allowed_payment_method_types: ["card"],
            subscription_data: { metadata: { yokkai_user_id: userId } },
            success_url: `${config.origin}/settings?checkout=returned#subscription`,
            cancel_url: `${config.origin}/settings?checkout=canceled#subscription`
          },
          { idempotencyKey: `yokkai-checkout:${account.id}:${nonce}` }
        );
        if (session.livemode !== config.live)
          throw new BillingError("BILLING_MODE_MISMATCH");
        const url = stripeDestination(
          session.url,
          "https://checkout.stripe.com"
        );
        await store.save(account, { checkout: session.id });
        return url;
      });
    },
    async status(userId: string) {
      await verifyAccount();
      return locked(userId, async account => {
        const { state } = await current(account);
        await store.save(account, { state });
        return { ...state, hasCustomer: !!account.stripe_customer_id };
      });
    },
    async portal(userId: string) {
      await verifyAccount();
      return locked(userId, async account => {
        if (!account.stripe_customer_id)
          throw new BillingError("BILLING_NO_SUBSCRIPTION", 409);
        const portal = await stripe.billingPortal.sessions.create({
          customer: account.stripe_customer_id,
          return_url: `${config.origin}/settings#subscription`
        });
        return stripeDestination(portal.url, "https://billing.stripe.com");
      });
    },
    async webhook(body: string, signature: string) {
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(
          body,
          signature,
          config.webhookSecret,
          300
        );
      } catch {
        throw new BillingError("BILLING_SIGNATURE_INVALID", 400);
      }
      if (event.livemode !== config.live || event.account)
        throw new BillingError("BILLING_MODE_MISMATCH", 400);
      if (!BILLING_EVENTS.has(event.type) || (await store.processed(event.id)))
        return;
      await verifyAccount();
      const object = event.data.object as unknown as {
        customer?: string | { id: string };
        charge?: string | Stripe.Charge;
      };
      let customer =
        typeof object.customer === "string"
          ? object.customer
          : object.customer?.id;
      if (!customer && object.charge) {
        const charge =
          typeof object.charge === "string"
            ? await stripe.charges.retrieve(object.charge)
            : object.charge;
        if (charge.livemode !== config.live)
          throw new BillingError("BILLING_MODE_MISMATCH", 400);
        customer =
          typeof charge.customer === "string"
            ? charge.customer
            : charge.customer?.id;
      }
      if (!customer) return;
      const userId = await store.owner(customer);
      if (!userId) return; // Metadata never establishes ownership.
      await locked(userId, async account => {
        if (account.stripe_customer_id !== customer)
          throw new BillingError("BILLING_REVIEW_REQUIRED");
        const { state } = await current(account);
        // Conservative, sticky hold: refunds/disputes/fraud require operator review; a stale event cannot reactivate access.
        const hold =
          event.type.startsWith("charge.") || event.type.startsWith("radar.");
        if (hold) state.active = false;
        await store.save(account, { state, event: event.id, hold });
      });
    },
    async reconcile(after: string) {
      const users = await store.reconciliationPage(after);
      const started = Date.now();
      let failed = 0,
        checked = 0,
        cursor = after;
      await verifyAccount();
      for (const user of users) {
        if (Date.now() - started > 20000) break;
        try {
          await locked(user.user_id, async account => {
            const { state } = await current(account);
            await store.save(account, { state });
          });
        } catch {
          failed++;
        }
        checked++;
        cursor = user.user_id;
      }
      logReconciliationFailure(checked, failed);
      return {
        checked,
        failed,
        next: checked < users.length || users.length === 100 ? cursor : null
      };
    }
  };
}

export function configuredBillingService() {
  const config = billingConfig();
  return billingService(
    config,
    new Stripe(config.secret, {
      apiVersion: Stripe.API_VERSION,
      maxNetworkRetries: 1,
      timeout: 10000
    }),
    billingStore(config)
  );
}
