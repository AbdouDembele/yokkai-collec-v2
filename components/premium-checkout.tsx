"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { BillingSettings } from "@/lib/billing/settings";

export function PremiumCheckout({
  signedIn,
  billing
}: {
  signedIn: boolean;
  billing: BillingSettings | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const active =
    billing?.enabled && billing.status?.active && !billing.unavailable;
  const hasCustomer = billing?.status?.hasCustomer === true;
  const canCheckout =
    signedIn &&
    billing?.enabled === true &&
    billing.checkoutEnabled &&
    !billing.unavailable &&
    billing.status !== null &&
    !billing.status.active &&
    ["not_subscribed", "canceled", "incomplete_expired"].includes(
      billing.status.status
    );
  const manageSubscription = active || (hasCustomer && !canCheckout);

  async function openCheckout() {
    if (!canCheckout || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const result = await response.json();
      if (!response.ok) {
        setError(
          result.code === "BILLING_USE_PORTAL"
            ? "A subscription already exists. Manage it from your account settings."
            : "Billing is temporarily unavailable. Please try again."
        );
        return;
      }
      const url = new URL(result.url);
      if (
        url.origin !== "https://checkout.stripe.com" ||
        url.username ||
        url.password
      )
        throw Error("Invalid destination");
      window.location.assign(url.href);
    } catch {
      setError("Billing is temporarily unavailable. Please try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <aside id="membership" className="yk-premium-price-card" aria-busy={busy}>
      <p className="eyebrow">Your membership</p>
      <h2>Yokkai Pro</h2>
      <p className="yk-premium-price">
        €4.99 <small>/ month</small>
      </p>
      <p>Monthly subscription. Cancel from your account settings.</p>
      {active && (
        <p className="text-success" role="status">
          Pro active
        </p>
      )}
      {billing?.sandbox && <p role="status">Test mode · No real payment.</p>}
      {signedIn && !billing?.checkoutEnabled && !active && (
        <p>Subscriptions are not available yet.</p>
      )}
      {signedIn && billing?.unavailable && (
        <p role="alert">Unable to verify your subscription right now.</p>
      )}
      {error && (
        <p className="text-danger" role="alert">
          {error}
        </p>
      )}
      {manageSubscription ? (
        <Link
          className="yk-button yk-button-primary"
          href="/settings#subscription"
        >
          Manage subscription
        </Link>
      ) : signedIn ? (
        <button
          className="yk-button yk-button-primary"
          type="button"
          disabled={!canCheckout || busy}
          aria-busy={busy}
          onClick={() => void openCheckout()}
        >
          {busy ? "OPENING STRIPE…" : "GET PRO"}
        </button>
      ) : (
        <Link
          className="yk-button yk-button-primary"
          href="/login?next=%2Fpremium"
        >
          GET PRO
        </Link>
      )}
      <p className="yk-pro-offer-footnote">
        Secure payments and invoices with Stripe. See our{" "}
        <Link href="/privacy" className="underline underline-offset-4">
          Privacy Policy
        </Link>
        .
      </p>
    </aside>
  );
}
