export type Locale = "en" | "fr";
export const LOCALE_COOKIE = "yokkai_locale";
export const localeCookieOptions = {
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 31536000
};

export function i18nEnabled() {
  return process.env.NEXT_PUBLIC_I18N_ENABLED === "true";
}
export function isLocaleIndependentImage(pathname: string) {
  return /^\/(?:signup\/)?(?:opengraph-image|twitter-image)(?:\/|$)/.test(
    pathname
  );
}
export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "fr";
}
export function parseLocaleCookie(value?: string) {
  const match = /^v1:(auto|manual):(en|fr):(new|seen)$/.exec(value ?? "");
  return match
    ? {
        mode: match[1] as "auto" | "manual",
        locale: match[2] as Locale,
        dismissed: match[3] === "seen"
      }
    : undefined;
}
export function localeCookie(
  locale: Locale,
  mode: "auto" | "manual",
  dismissed = false
) {
  return `v1:${mode}:${locale}:${dismissed ? "seen" : "new"}`;
}

export function resolveLocale({
  enabled,
  profile,
  cookie,
  acceptLanguage,
  country,
  trustedCountry = false
}: {
  enabled: boolean;
  profile?: unknown;
  cookie?: string;
  acceptLanguage?: string | null;
  country?: string | null;
  trustedCountry?: boolean;
}) {
  const saved = parseLocaleCookie(cookie);
  if (!enabled)
    return { locale: "en" as Locale, mode: "auto" as const, dismissed: true };
  if (isLocale(profile))
    return {
      locale: profile,
      mode: "manual" as const,
      dismissed: saved?.dismissed ?? true
    };
  if (saved) return saved;
  const languages = (acceptLanguage ?? "")
    .slice(0, 4096)
    .split(",")
    .map((part, index) => {
      const match =
        /^\s*([a-z]{1,8}(?:-[a-z0-9]{1,8})*|\*)\s*(?:;\s*q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?\s*$/i.exec(
          part
        );
      return match
        ? {
            locale: match[1].toLowerCase().split("-")[0],
            q: match[2] === undefined ? 1 : Number(match[2]),
            index
          }
        : null;
    })
    .filter(part => part !== null);
  const supported = languages
    .filter(part => isLocale(part.locale) && part.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  if (supported[0])
    return {
      locale: supported[0].locale as Locale,
      mode: "auto" as const,
      dismissed: false
    };
  const excluded = languages.some(
    part => (part.locale === "fr" || part.locale === "*") && part.q === 0
  );
  const frenchCountry =
    trustedCountry &&
    !excluded &&
    /^(MA|DZ|TN|FR|BE|LU|MC|SN|CI)$/.test(country ?? "");
  return {
    locale: frenchCountry ? ("fr" as const) : ("en" as const),
    mode: "auto" as const,
    dismissed: false
  };
}
