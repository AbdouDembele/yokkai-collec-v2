import "server-only";
import { BillingError } from "./config";

export type BillingOperation =
  | "request"
  | "checkout"
  | "portal"
  | "status"
  | "webhook"
  | "reconcile"
  | "settings";

// Allowlisted fields only: never serialize an exception, provider response,
// request, user ID, email, signature, URL, or credential into operational logs.
const codes = new Set([
  "BILLING_CONFIGURATION",
  "BILLING_ACCOUNT_MISMATCH",
  "BILLING_MODE_MISMATCH",
  "BILLING_REVIEW_REQUIRED",
  "BILLING_BUSY",
  "BILLING_STORAGE_UNAVAILABLE",
  "BILLING_UNAVAILABLE"
]);
const lastLogged = new Map<string, number>();

export function logBillingFailure(operation: BillingOperation, error: unknown) {
  const known = error instanceof BillingError;
  if (known && error.status < 500) return;
  const code =
    known && codes.has(error.code) ? error.code : "BILLING_UNAVAILABLE";
  const key = `${operation}:${code}`;
  const now = Date.now();
  // One event per operation/code/minute per worker; failures still return their
  // original status. Repeated unauthenticated requests cannot flood stderr.
  if (now - (lastLogged.get(key) ?? -Infinity) < 60000) return;
  lastLogged.set(key, now);
  console.error(
    JSON.stringify({
      event: "billing.failure",
      severity: "error",
      operation,
      code,
      at: new Date(now).toISOString()
    })
  );
}

export function logReconciliationFailure(checked: number, failed: number) {
  if (!failed) return;
  console.error(
    JSON.stringify({
      event: "billing.reconciliation_partial_failure",
      severity: "error",
      checked,
      failed,
      at: new Date().toISOString()
    })
  );
}
