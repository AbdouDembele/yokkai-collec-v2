import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createTranslator } from "next-intl";
import english from "@/messages/en.json";
import french from "@/messages/fr.json";
import {
  updateSession,
  type ProxySessionContext
} from "@/utils/supabase/proxy";
import {
  i18nEnabled,
  parseLocaleCookie,
  isLocale,
  isLocaleIndependentImage,
  LOCALE_COOKIE,
  localeCookie,
  localeCookieOptions,
  resolveLocale
} from "@/i18n/locale";

const maintenancePage = (locale: "en" | "fr") => {
  const t = createTranslator({
    locale,
    messages: locale === "fr" ? french : english,
    namespace: "maintenance"
  });
  return `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>${t("title")}</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      html, body { min-height: 100%; }
      body {
        margin: 0;
        display: grid;
        place-items: center;
        padding: 24px;
        color: #f2f0ff;
        background: radial-gradient(circle at 50% 10%, rgba(82, 68, 181, .25), transparent 42%), #090714;
        font-family: Sora, Inter, ui-sans-serif, system-ui, sans-serif;
      }
      main {
        width: min(100%, 620px);
        padding: clamp(32px, 8vw, 64px);
        text-align: center;
        background: rgba(15, 12, 29, .92);
        border: 1px solid #2e276d;
        border-radius: 24px;
        box-shadow: 0 24px 72px rgba(4, 0, 11, .72), 0 0 36px rgba(82, 68, 181, .18);
      }
      .eyebrow { margin: 0 0 18px; color: #ffcc33; font-size: 12px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
      h1 { margin: 0; font-family: Cinzel, Georgia, serif; font-size: clamp(30px, 7vw, 48px); line-height: 1.12; letter-spacing: .03em; }
      p { margin: 22px auto 0; max-width: 46ch; color: #a29dbe; font-size: clamp(15px, 3vw, 18px); line-height: 1.65; }
      .mark { display: inline-grid; width: 52px; height: 52px; margin-bottom: 24px; place-items: center; color: #ffb700; border: 1px solid rgba(255, 183, 0, .45); border-radius: 50%; box-shadow: 0 0 24px rgba(255, 183, 0, .18); font: 700 22px/1 Cinzel, Georgia, serif; }
    </style>
  </head>
  <body>
    <main>
      <div class="mark" aria-hidden="true">Y</div>
      <p class="eyebrow">${t("eyebrow")}</p>
      <h1>${t("heading")}</h1>
      <p>${t("description")}</p>
    </main>
  </body>
</html>`;
};

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const enabled = i18nEnabled();
  const savedLocale = enabled
    ? parseLocaleCookie(request.cookies.get(LOCALE_COOKIE)?.value)
    : undefined;
  // No client-supplied internal locale header is read anywhere.
  const preference = resolveLocale(
    enabled
      ? {
          enabled,
          cookie: request.cookies.get(LOCALE_COOKIE)?.value,
          acceptLanguage: request.headers.get("accept-language"),
          country: request.headers.get("cf-ipcountry"),
          trustedCountry: process.env.I18N_TRUST_CF_COUNTRY === "true"
        }
      : { enabled }
  );
  let value = localeCookie(
    preference.locale,
    preference.mode,
    preference.dismissed
  );
  if (enabled && !isLocaleIndependentImage(pathname))
    request.cookies.set(LOCALE_COOKIE, value);
  if (process.env.MAINTENANCE_MODE === "true") {
    const response = new NextResponse(maintenancePage(preference.locale), {
      status: 503,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "Content-Type": "text/html; charset=utf-8",
        "Retry-After": "3600",
        "X-Robots-Tag": "noindex, nofollow"
      }
    });
    if (enabled)
      response.cookies.set(LOCALE_COOKIE, value, localeCookieOptions);
    return response;
  }

  if (
    process.env.NODE_ENV === "production" &&
    (pathname === "/design-system" || pathname.startsWith("/design-system/"))
  ) {
    return new Response("Not found", {
      status: 404,
      headers: { "X-Robots-Tag": "noindex, nofollow" }
    });
  }
  // Only the known generated OG/Twitter images bypass locale personalization.
  if (enabled && isLocaleIndependentImage(pathname)) {
    return updateSession(request);
  }
  const sharedPage =
    /^\/share\/[0-9a-f]{32}(?:\/image\/(?:og|story|square))?$/.test(pathname);
  if (sharedPage && pathname.includes("/image/")) return NextResponse.next();
  const session: ProxySessionContext = {};
  const response = sharedPage
    ? NextResponse.next({ request })
    : await updateSession(request, session);
  // A valid cookie is authoritative. Only recover a missing preference once,
  // before HTML rendering, so the recovered profile also reaches the browser.
  if (enabled && !savedLocale && !pathname.startsWith("/api/")) {
    try {
      const [
        { createServerClient },
        { getSupabaseConfig },
        { serverAuthFetch }
      ] = await Promise.all([
        import("@supabase/ssr"),
        import("@/utils/supabase/config"),
        import("@/utils/supabase/auth-fetch")
      ]);
      const { url, key, cookieName } = getSupabaseConfig();
      const client =
        session.client ??
        createServerClient(url, key, {
          cookieOptions: { name: cookieName },
          global: { fetch: serverAuthFetch(url, request.headers) },
          cookies: {
            getAll: () => request.cookies.getAll(),
            setAll: (values, headers) => {
              values.forEach(({ name, value, options }) => {
                request.cookies.set(name, value);
                response.cookies.set(name, value, options);
              });
              Object.entries(headers).forEach(([name, value]) =>
                response.headers.set(name, value)
              );
            }
          }
        });
      // Reuse the verification already performed in THIS proxy invocation.
      // Public share pages bypass updateSession, so they still verify here.
      const authenticated = session.client
        ? session.authenticated
        : Boolean((await client.auth.getClaims()).data?.claims?.sub);
      if (authenticated) {
        const { data: locale, error } = await client
          .rpc("get_my_locale")
          .abortSignal(AbortSignal.timeout(5000));
        if (!error && isLocale(locale))
          value = localeCookie(locale, "manual", true);
      }
      request.cookies.set(LOCALE_COOKIE, value);
      if (response.headers.has("x-middleware-override-headers"))
        response.headers.set(
          "x-middleware-request-cookie",
          request.headers.get("cookie") ?? ""
        );
    } catch {
      // A preference lookup cannot break Auth or the browser-language fallback.
    }
  }
  if (enabled && !response.cookies.has(LOCALE_COOKIE)) {
    response.cookies.set(LOCALE_COOKIE, value, localeCookieOptions);
  }
  if (enabled) response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: [
    "/design-system/:path*",
    "/((?!_next/static|_next/image|favicon.ico|fonts/.*\\.(?:woff2?|ttf|otf)$|assets/sfx/.*\\.mp3$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"
  ]
};
