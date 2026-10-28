export const OAUTH_PROVIDERS = ["google", "discord"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export const OAUTH_PROVIDER_NAMES: Record<OAuthProvider, string> = {
  google: "Google",
  discord: "Discord"
};

// Survives the provider round trip; read only by the username step.
export const OAUTH_REFERRAL_COOKIE = "yk-oauth-referral";

export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return OAUTH_PROVIDERS.some(provider => provider === value);
}

// Only same-origin paths: never an absolute URL, //host or \host (open redirect).
export function safeNextPath(value: unknown, fallback = "/boosters") {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  )
    return fallback;
  try {
    const base = "http://next.invalid";
    const url = new URL(value, base);
    return url.origin === base
      ? url.pathname + url.search + url.hash
      : fallback;
  } catch {
    return fallback;
  }
}

// GoTrue's PKCE callback errors become a stable code on /login?oauth=<code>.
export function oauthCallbackFailure(params: URLSearchParams) {
  if (params.get("error_code") === "provider_email_needs_verification")
    return "verify-email";
  if (params.get("error") === "access_denied") return "denied";
  return "error";
}

export function oauthCallbackMessage(code: string | undefined) {
  switch (code) {
    case "denied":
      return "Sign-in was cancelled or refused. Try again, or use your email and password.";
    case "verify-email":
      return "Your email address isn't verified with this provider yet. Check your inbox for a confirmation link, then try again.";
    case "service":
      return "Sign-in is temporarily unavailable. Please try again in a moment.";
    case "error":
      return "We couldn't complete sign-in with this provider. Please try again.";
    default:
      return undefined;
  }
}

// Read once by the account-linked notice after a provider sign-in.
export const OAUTH_LINKED_COOKIE = "yk-oauth-linked";

type LinkedUser = {
  created_at?: string;
  identities?: { provider: string; created_at?: string }[];
};

// GoTrue links a verified provider email to the existing account on its own:
// the provider identity is then new while the account is older.
export function newlyLinkedProvider(user: LinkedUser, now = Date.now()) {
  const accountCreated = Date.parse(user.created_at ?? "");
  const identity = (user.identities ?? [])
    .filter(entry => isOAuthProvider(entry.provider))
    .map(entry => ({ ...entry, at: Date.parse(entry.created_at ?? "") }))
    .sort((a, b) => b.at - a.at)[0];
  return identity &&
    now - identity.at < 10 * 60 * 1000 &&
    identity.at - accountCreated > 60 * 1000
    ? (identity.provider as OAuthProvider)
    : undefined;
}
