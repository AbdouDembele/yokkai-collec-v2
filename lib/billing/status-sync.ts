"use client";

import type { BillingStatus } from "./settings";

// Protected server reads only; browser events and Stripe returns never grant access.
export function watchBillingStatus(
  update: (status: BillingStatus) => void,
  unavailable: () => void,
  actionPending: () => boolean
) {
  let stopped = false;
  let controller: AbortController | null = null;
  async function sync() {
    if (
      stopped ||
      document.visibilityState !== "visible" ||
      controller ||
      actionPending()
    )
      return;
    const request = new AbortController();
    controller = request;
    const timeout = window.setTimeout(() => request.abort(), 10000);
    try {
      const response = await fetch("/api/billing/status", {
        cache: "no-store",
        signal: request.signal
      });
      if (!response.ok) throw Error("Status unavailable");
      const status = (await response.json()) as BillingStatus;
      if (
        !stopped &&
        !request.signal.aborted &&
        document.visibilityState === "visible"
      )
        update(status);
    } catch {
      if (!stopped && document.visibilityState === "visible") unavailable();
    } finally {
      window.clearTimeout(timeout);
      controller = null;
    }
  }
  const resume = () => {
    void sync();
  };
  window.addEventListener("focus", resume);
  window.addEventListener("pageshow", resume);
  window.addEventListener("online", resume);
  document.addEventListener("visibilitychange", resume);
  const interval = window.setInterval(resume, 30000);
  resume();
  return () => {
    stopped = true;
    controller?.abort();
    window.clearInterval(interval);
    window.removeEventListener("focus", resume);
    window.removeEventListener("pageshow", resume);
    window.removeEventListener("online", resume);
    document.removeEventListener("visibilitychange", resume);
  };
}
