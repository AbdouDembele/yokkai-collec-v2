import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "@/utils/supabase/config";
import { serverAuthFetch } from "@/utils/supabase/auth-fetch";

// Created inside one proxy invocation. Never populate this from request headers,
// cookies or a module-level cache; only getClaims() below can verify identity.
export type ProxySessionContext = {
  client?: ReturnType<typeof createServerClient>;
  authenticated?: boolean;
};

export async function updateSession(
  request: NextRequest,
  context?: ProxySessionContext
) {
  const { url, key, cookieName } = getSupabaseConfig();
  let response = NextResponse.next({ request });
  const responseHeaders = new Headers();

  const supabase = createServerClient(url, key, {
    cookieOptions: { name: cookieName },
    global: { fetch: serverAuthFetch(url, request.headers) },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        const previousCookies = response.cookies.getAll();
        response = NextResponse.next({ request });
        previousCookies.forEach(cookie => response.cookies.set(cookie));
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
        // A response containing refreshed session cookies must not be cached.
        if (!responseHeaders.has("Cache-Control")) {
          responseHeaders.set("Cache-Control", "private, no-store");
        }
        Object.entries(headers).forEach(([name, value]) =>
          responseHeaders.set(name, value)
        );
        responseHeaders.forEach((value, name) =>
          response.headers.set(name, value)
        );
      }
    }
  });

  // Creating the client alone does not refresh the session.
  const { data } = await supabase.auth.getClaims();

  // A new Google/Discord account must choose its username before any game page.
  // Its token carries user_metadata.pseudo once chosen, so only pending OAuth
  // sessions query the database. A failed check lets the request through.
  const claims = data?.claims;
  if (context) {
    context.client = supabase;
    context.authenticated =
      typeof claims?.sub === "string" && claims.sub.length > 0;
  }
  const provider = claims?.app_metadata?.provider;
  if (
    (provider === "google" || provider === "discord") &&
    typeof claims?.user_metadata?.pseudo !== "string" &&
    !/^\/(choose-username|auth|terms|rules|info|discord|account-deleted)(\/|$)/.test(
      request.nextUrl.pathname
    )
  ) {
    const { data: required } = await supabase.rpc("is_pseudo_required");
    if (required === true) {
      const redirect = NextResponse.redirect(
        new URL("/choose-username", request.url)
      );
      response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie));
      redirect.headers.set("Cache-Control", "private, no-store");
      return redirect;
    }
  }

  return response;
}
