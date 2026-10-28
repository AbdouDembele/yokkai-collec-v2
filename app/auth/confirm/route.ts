import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { syncProfileLocale } from "@/i18n/server";

function publicOrigin(request: NextRequest) {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (configuredUrl) {
    try {
      const site = new URL(configuredUrl);
      if (
        ["http:", "https:"].includes(site.protocol) &&
        !site.username &&
        !site.password
      ) {
        return site.origin;
      }
    } catch {
      // Fall back to the request origin when the optional setting is invalid.
    }
  }
  return request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const code = params.get("code");
  const recoveryRequested =
    params.get("next") === "/reset-password" || type === "recovery";
  let confirmed = false;
  let failure = "erreur";
  try {
    if (
      !params.has("error") &&
      (code ||
        (tokenHash && ["email", "signup", "recovery"].includes(type ?? "")))
    ) {
      const supabase = createClient(await cookies());
      // Support the default PKCE email and the token-hash email template.
      const { error } = code
        ? await supabase.auth.exchangeCodeForSession(code)
        : await supabase.auth.verifyOtp({
            token_hash: tokenHash!,
            type: type as "email" | "signup" | "recovery"
          });
      confirmed = !error;
      if (confirmed) await syncProfileLocale(supabase);
      if (
        error &&
        ((error.status ?? 0) >= 500 || error.name === "AuthRetryableFetchError")
      )
        failure = "service";
    }
  } catch {
    failure = "service";
  }
  const response = NextResponse.redirect(
    new URL(
      confirmed
        ? recoveryRequested
          ? "/reset-password"
          : type === "signup"
            ? "/boosters"
            : "/"
        : recoveryRequested
          ? `/forgot-password?lien=${failure}`
          : `/login?confirmation=${failure}`,
      publicOrigin(request)
    )
  );
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
