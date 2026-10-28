"use server";

import { cookies, headers } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  i18nEnabled,
  isLocale,
  LOCALE_COOKIE,
  localeCookie,
  localeCookieOptions,
  parseLocaleCookie,
  resolveLocale
} from "@/i18n/locale";

export async function setLocalePreference(value: string) {
  if (!i18nEnabled()) return { ok: false };
  if (value !== "auto" && !isLocale(value)) return { ok: false };
  const store = await cookies();
  const client = createClient(store);
  const { data } = await client.auth.getUser();
  if (data.user) {
    const { error } = await client.rpc("set_my_locale", {
      p_locale: value === "auto" ? null : value
    });
    if (error) return { ok: false };
  }
  const requestHeaders = await headers();
  const locale = isLocale(value)
    ? value
    : resolveLocale({
        enabled: true,
        acceptLanguage: requestHeaders.get("accept-language"),
        country: requestHeaders.get("cf-ipcountry"),
        trustedCountry: process.env.I18N_TRUST_CF_COUNTRY === "true"
      }).locale;
  store.set(
    LOCALE_COOKIE,
    localeCookie(locale, value === "auto" ? "auto" : "manual", true),
    localeCookieOptions
  );
  return { ok: true };
}

export async function dismissLocaleBanner() {
  if (!i18nEnabled()) return;
  const store = await cookies();
  const saved = parseLocaleCookie(store.get(LOCALE_COOKIE)?.value);
  if (saved)
    store.set(
      LOCALE_COOKIE,
      localeCookie(saved.locale, saved.mode, true),
      localeCookieOptions
    );
}
