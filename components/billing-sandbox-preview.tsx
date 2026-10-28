"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { watchBillingStatus } from "@/lib/billing/status-sync";

type Status = {
  active: boolean;
  status: string;
  endsAt: number | null;
  cancelAtPeriodEnd: boolean;
  hasCustomer: boolean;
};

export function BillingSandboxPreview({ signedIn }: { signedIn: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const pending = useRef(false);

  useEffect(() => {
    if (!signedIn) return;
    return watchBillingStatus(
      current => {
        setStatus(current);
        setSyncError("");
      },
      () =>
        setSyncError("Unable to verify test billing. Retrying automatically."),
      () => pending.current
    );
  }, [signedIn]);

  async function openStripe(action: "checkout" | "portal") {
    if (pending.current || !signedIn) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/billing/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.code === "BILLING_USE_PORTAL")
          setError(
            "A test subscription or completed Checkout already exists. Your status will update automatically."
          );
        else
          setError(
            "Unable to open Stripe test billing. Check the local server and test-key permissions, then retry."
          );
        return;
      }
      const url = new URL(result.url);
      const allowed =
        action === "checkout"
          ? "https://checkout.stripe.com"
          : "https://billing.stripe.com";
      if (url.origin !== allowed || url.username || url.password)
        throw new Error("Invalid destination");
      window.location.assign(url.href);
    } catch {
      setError("Unable to open Stripe test billing. Please retry.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 760, margin: "48px auto", padding: 24 }}>
      <p className="eyebrow">Local billing test</p>
      <h1>Yokkai Pro · Stripe Sandbox</h1>
      <p>€4.99 per month · No free trial · No real money charged.</p>
      <p>
        This page tests billing only. Production accounts, game perks and
        collections are unchanged.
      </p>
      <p className="mt-4">
        <Link href="/settings#subscription" className="yk-button">
          Open subscription settings
        </Link>
      </p>
      {!signedIn ? (
        <p>
          <Link href="/login">Sign in with your local account</Link>, then
          return to this page.
        </p>
      ) : (
        <>
          <section
            aria-label="Test subscription status"
            style={{
              padding: 24,
              margin: "24px 0",
              border: "1px solid #39304e",
              borderRadius: 16
            }}
          >
            <h2>Test subscription</h2>
            <p role="status">
              {status
                ? status.active
                  ? "Active · test billing verified"
                  : `Not active · ${status.status.replaceAll("_", " ")}`
                : "Checking test billing automatically…"}
            </p>
            {status?.endsAt && (
              <p>
                Current period ends{" "}
                {new Intl.DateTimeFormat("en-US", {
                  dateStyle: "medium",
                  timeStyle: "short"
                }).format(status.endsAt * 1000)}
                .
              </p>
            )}
            {status?.cancelAtPeriodEnd && (
              <p>
                Cancellation is scheduled for the end of the paid test period.
              </p>
            )}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button
                className="button"
                disabled={busy || !!status?.active}
                onClick={() => void openStripe("checkout")}
              >
                Start test subscription
              </button>
              <button
                className="button"
                disabled={busy || !status?.hasCustomer}
                onClick={() => void openStripe("portal")}
              >
                Manage test subscription
              </button>
            </div>
          </section>
          {(error || syncError) && <p role="alert">{error || syncError}</p>}
        </>
      )}
      <section aria-label="Test card instructions">
        <h2>Use a test card only</h2>
        <p>
          Card: <code>4242 4242 4242 4242</code>. Use a future expiry date and
          any three-digit CVC.
        </p>
        <p>
          For a declined payment, use <code>4000 0000 0000 0002</code>. Never
          enter a real card on this test page.
        </p>
      </section>
    </main>
  );
}
