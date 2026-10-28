import type Stripe from "stripe";
import { BillingError } from "./config";

export const PRO_PRICE = {
  amount: 499,
  currency: "eur",
  interval: "month"
} as const;
export const BILLING_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.expired",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "invoice.finalization_failed",
  "charge.dispute.created",
  "charge.dispute.closed",
  "charge.refunded",
  "radar.early_fraud_warning.created"
]);

export type SubscriptionState = {
  active: boolean;
  status: string;
  endsAt: number | null;
  cancelAtPeriodEnd: boolean;
};
export const BASIC_STATE: SubscriptionState = {
  active: false,
  status: "not_subscribed",
  endsAt: null,
  cancelAtPeriodEnd: false
};

export function validateProPrice(price: Stripe.Price, live: boolean) {
  if (
    price.livemode !== live ||
    !price.active ||
    price.type !== "recurring" ||
    price.unit_amount !== PRO_PRICE.amount ||
    price.currency !== PRO_PRICE.currency ||
    price.recurring?.interval !== "month" ||
    price.recurring.interval_count !== 1 ||
    price.recurring.usage_type !== "licensed"
  ) {
    throw new BillingError("BILLING_PRICE_INVALID");
  }
}

export function subscriptionState(
  list: Stripe.ApiList<Stripe.Subscription>,
  price: string,
  live: boolean,
  now = Date.now()
): SubscriptionState {
  if (list.has_more || list.data.some(sub => sub.livemode !== live))
    throw new BillingError("BILLING_REVIEW_REQUIRED");
  const matching = list.data.filter(sub =>
    sub.items.data.some(item => item.price.id === price)
  );
  if (
    matching.filter(
      sub => !["canceled", "incomplete_expired"].includes(sub.status)
    ).length > 1
  )
    throw new BillingError("BILLING_REVIEW_REQUIRED");
  const current =
    matching.find(
      sub => !["canceled", "incomplete_expired"].includes(sub.status)
    ) ?? matching[0];
  if (!current) return { ...BASIC_STATE };
  const item = current.items.data.find(item => item.price.id === price)!;
  const invoice =
    typeof current.latest_invoice === "object" ? current.latest_invoice : null;
  const invoiceSubscription =
    invoice?.parent?.subscription_details?.subscription;
  const invoiceOwner =
    typeof invoiceSubscription === "string"
      ? invoiceSubscription
      : invoiceSubscription?.id;
  const covered =
    invoice?.lines &&
    !invoice.lines.has_more &&
    invoice.lines.data.some(line => {
      const linePrice = line.pricing?.price_details?.price;
      return (
        (typeof linePrice === "string" ? linePrice : linePrice?.id) === price &&
        line.period.start * 1000 <= now &&
        line.period.end >= item.current_period_end &&
        line.amount > 0
      );
    });
  // A browser return, an active-but-unpaid subscription or a trial never grants Pro.
  const active =
    current.status === "active" &&
    !current.pause_collection &&
    current.items.data.length === 1 &&
    item.quantity === 1 &&
    Number.isSafeInteger(item.current_period_end) &&
    item.current_period_end * 1000 > now &&
    !!invoice &&
    invoiceOwner === current.id &&
    !!covered &&
    invoice.currency === PRO_PRICE.currency &&
    invoice.status === "paid" &&
    invoice.livemode === live &&
    invoice.amount_paid > 0;
  return {
    active: !!active,
    status: current.status,
    endsAt: Number.isSafeInteger(item.current_period_end)
      ? item.current_period_end
      : null,
    // The portal may schedule the same cancellation using cancel_at instead.
    cancelAtPeriodEnd:
      current.cancel_at_period_end ||
      (Number.isSafeInteger(current.cancel_at) &&
        current.cancel_at! > 0 &&
        current.cancel_at === item.current_period_end)
  };
}

export function stripeDestination(value: string | null, origin: string) {
  try {
    const url = new URL(value!);
    if (url.origin === origin && !url.username && !url.password) return value!;
  } catch {
    /* fail closed */
  }
  throw new BillingError("BILLING_REDIRECT_INVALID", 502);
}
