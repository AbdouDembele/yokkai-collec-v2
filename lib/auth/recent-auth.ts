// Only pass claims returned by Supabase auth.getClaims(), never decoded input.
export function hasRecentAuthentication(
  claims: Record<string, unknown>,
  now = Math.floor(Date.now() / 1000)
) {
  const recent = (time: unknown) =>
    typeof time === "number" &&
    Number.isSafeInteger(time) &&
    time > 0 &&
    time <= now &&
    now - time <= 300;
  if ("auth_time" in claims) return recent(claims.auth_time);
  if (!Array.isArray(claims.amr)) return false;
  // Supabase records primary authentication here. iat/token_refresh only date
  // token issuance and must never turn an old login into a recent login.
  const logins = claims.amr.filter(
    entry =>
      entry && ["password", "magiclink", "otp", "oauth"].includes(entry.method)
  );
  return logins.length > 0 && logins.every(entry => recent(entry.timestamp));
}
