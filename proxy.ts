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
      @font-face { font-family: "Sora"; src: url("/fonts/Sora-Bold.ttf") format("truetype"); font-weight: 700; font-display: swap; }
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      html, body { min-height: 100%; }
      body {
        position: relative;
        margin: 0;
        min-height: 100dvh;
        display: grid;
        place-items: center;
        padding: 24px 16px;
        overflow-x: hidden;
        color: #eef4ff;
        background:
          radial-gradient(900px 520px at 50% -10%, rgba(88, 140, 255, .32), transparent 70%),
          radial-gradient(700px 420px at 100% 110%, rgba(60, 110, 230, .22), transparent 70%),
          #060913;
        font-family: Sora, Inter, ui-sans-serif, system-ui, sans-serif;
      }
      body::before {
        content: "";
        position: fixed;
        inset: 0;
        z-index: -1;
        background: url("/assets/yokkai-site-backdrop.webp") center / cover no-repeat;
        opacity: .12;
        mix-blend-mode: screen;
        pointer-events: none;
      }
      main {
        width: min(100%, 640px);
        padding: clamp(28px, 7vw, 56px) clamp(20px, 6vw, 56px);
        text-align: center;
        background: linear-gradient(180deg, rgba(14, 24, 46, .86), rgba(8, 13, 24, .92));
        border: 1px solid rgba(140, 180, 255, .22);
        border-radius: 28px;
        box-shadow: 0 30px 80px rgba(0, 4, 14, .7), 0 0 60px rgba(70, 120, 255, .16), inset 0 1px 0 rgba(255, 255, 255, .06);
        backdrop-filter: blur(6px);
      }
      .logo {
        display: block;
        width: min(78%, 340px);
        height: auto;
        margin: 0 auto 28px;
        filter: drop-shadow(0 0 22px rgba(110, 160, 255, .45));
        animation: float 6s ease-in-out infinite;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        margin: 0 0 20px;
        padding: 8px 16px;
        color: #bcd3ff;
        background: rgba(90, 140, 255, .12);
        border: 1px solid rgba(140, 180, 255, .3);
        border-radius: 999px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: .12em;
        text-transform: uppercase;
      }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: #7fb0ff; box-shadow: 0 0 0 0 rgba(127, 176, 255, .7); animation: pulse 2s ease-out infinite; }
      h1 { margin: 0; font-size: clamp(24px, 6vw, 38px); font-weight: 700; line-height: 1.2; overflow-wrap: anywhere; background: linear-gradient(180deg, #ffffff, #b9cfff); -webkit-background-clip: text; background-clip: text; color: transparent; }
      p { margin: 18px auto 0; max-width: 44ch; color: #9fb1d4; font-size: clamp(15px, 3.6vw, 17px); line-height: 1.7; }
      .bar { position: relative; height: 4px; margin: 32px auto 0; max-width: 260px; overflow: hidden; border-radius: 999px; background: rgba(140, 180, 255, .14); }
      .bar::after { content: ""; position: absolute; inset: 0; width: 40%; border-radius: inherit; background: linear-gradient(90deg, transparent, #7fb0ff, transparent); animation: slide 1.8s ease-in-out infinite; }
      @keyframes float { 50% { transform: translateY(-8px); } }
      @keyframes pulse { 70% { box-shadow: 0 0 0 10px rgba(127, 176, 255, 0); } 100% { box-shadow: 0 0 0 0 rgba(127, 176, 255, 0); } }
      @keyframes slide { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
      @media (prefers-reduced-motion: reduce) { .logo, .dot, .bar::after { animation: none; } }
    </style>
  </head>
  <body>
    <main>
      <img class="logo" src="/_next/image?url=%2Fassets%2Fbrand-logo-ice-retro.png&amp;w=640&amp;q=75" srcset="/_next/image?url=%2Fassets%2Fbrand-logo-ice-retro.png&amp;w=384&amp;q=75 384w, /_next/image?url=%2Fassets%2Fbrand-logo-ice-retro.png&amp;w=640&amp;q=75 640w, /_next/image?url=%2Fassets%2Fbrand-logo-ice-retro.png&amp;w=828&amp;q=75 828w" sizes="(max-width: 480px) 78vw, 340px" width="1672" height="941" alt="Yokkai Collec'">
      <p class="badge"><span class="dot" aria-hidden="true"></span>${t("eyebrow")}</p>
      <h1>${t("heading")}</h1>
      <p>${t("description")}</p>
      <div class="bar" aria-hidden="true"></div>
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
