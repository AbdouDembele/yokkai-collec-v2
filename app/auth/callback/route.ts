import { syncProfileLocale } from "@/i18n/server";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  newlyLinkedProvider,
  OAUTH_LINKED_COOKIE,
  oauthCallbackFailure,
  safeNextPath
} from "@/lib/auth/oauth";

function publicOrigin(request: NextRequest) {
  try {
    const site = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "");
    if (
      ["http:", "https:"].includes(site.protocol) &&
      !site.username &&
      !site.password
    )
      return site.origin;
  } catch {
    // Fall back to the request origin when the optional setting is invalid.
  }
  return request.nextUrl.origin;
}

// OAuth (PKCE) return from GoTrue: exchange the code, then go to an internal path.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  let target = `/login?oauth=${oauthCallbackFailure(params)}`;
  if (code && !params.has("error")) {
    try {
      const cookieStore = await cookies();
      const client = createClient(cookieStore);
      const { data, error } = await client.auth.exchangeCodeForSession(code);
      if (!error) {
        await syncProfileLocale(client);
        // Sign-in lands on home. A new account is held by the proxy on
        // /choose-username, which then opens /boosters like an email signup.
        target = safeNextPath(params.get("next"), "/");
        const linked = data.user && newlyLinkedProvider(data.user);
        if (linked)
          cookieStore.set(OAUTH_LINKED_COOKIE, linked, {
            sameSite: "lax",
            path: "/",
            maxAge: 120
          });
      } else if (
        (error.status ?? 0) >= 500 ||
        error.name === "AuthRetryableFetchError"
      )
        target = "/login?oauth=service";
    } catch {
      target = "/login?oauth=service";
    }
  }
  // The proxy sends new accounts to the username step before any game page.
  const response = NextResponse.redirect(
    new URL(target, publicOrigin(request))
  );
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
