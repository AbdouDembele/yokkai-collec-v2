import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  i18nEnabled,
  isLocale,
  parseLocaleCookie,
  LOCALE_COOKIE,
  localeCookie,
  localeCookieOptions,
  resolveLocale
} from "./locale";

export async function profileLocale(client: ReturnType<typeof createClient>) {
  try {
    const { data, error } = await client
      .rpc("get_my_locale")
      .abortSignal(AbortSignal.timeout(5000));
    return !error && isLocale(data) ? data : undefined;
  } catch {
    return undefined;
  }
}

export const getLocalePreference = cache(async () => {
  const enabled = i18nEnabled();
  if (!enabled) return resolveLocale({ enabled });
  const store = await cookies();
  const cookie = store.get(LOCALE_COOKIE)?.value;
  const saved = parseLocaleCookie(cookie);
  if (saved) return saved;
  const requestHeaders = await headers();
  const client = createClient(store);
  let profile;
  try {
    const { data } = await client.auth.getClaims();
    profile = data?.claims?.sub ? await profileLocale(client) : undefined;
  } catch {
    /* Locale failures must not break public pages or authentication. */
  }
  return resolveLocale({
    enabled,
    profile,
    cookie,
    acceptLanguage: requestHeaders.get("accept-language"),
    country: requestHeaders.get("cf-ipcountry"),
    trustedCountry: process.env.I18N_TRUST_CF_COUNTRY === "true"
  });
});

export async function syncProfileLocale(
  client: ReturnType<typeof createClient>
) {
  if (!i18nEnabled()) return;
  const locale = await profileLocale(client);
  if (!locale) return;
  const store = await cookies();
  store.set(
    LOCALE_COOKIE,
    localeCookie(locale, "manual", true),
    localeCookieOptions
  );
}
