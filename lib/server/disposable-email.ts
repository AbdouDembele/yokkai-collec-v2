import "server-only";
import { domainToASCII } from "node:url";
import snapshot from "@/data/disposable-email-domains.json";

const allowed = new Set(snapshot.allowlist);
const blocked = new Set(snapshot.domains);

/** Returns a normalized DNS domain, never a full address or an exception. */
export function signupEmailDomain(email: unknown): string | undefined {
  if (typeof email !== "string") return undefined;
  const value = email.trim();
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(value)) return undefined;
  const raw = value.slice(value.indexOf("@") + 1).normalize("NFKC");
  if (/[\\/:@?#%\[\]]/.test(raw)) return undefined;
  const domain = domainToASCII(raw).toLowerCase().replace(/\.$/, "");
  if (
    !domain ||
    domain.length > 253 ||
    !domain.includes(".") ||
    domain
      .split(".")
      .some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    return undefined;
  return domain;
}

/** Invalid addresses remain the responsibility of the existing Auth validator. */
export function disposableEmailDomain(email: unknown): string | undefined {
  const domain = signupEmailDomain(email);
  if (!domain || allowed.has(domain)) return undefined;
  const labels = domain.split(".");
  // A bounded number of Set lookups, never a scan of the domain list.
  for (let offset = 0; offset < labels.length - 1; offset++) {
    const candidate = labels.slice(offset).join(".");
    if (blocked.has(candidate)) return candidate;
  }
  return undefined;
}
export function isDisposableEmail(email: unknown): boolean {
  return disposableEmailDomain(email) !== undefined;
}
