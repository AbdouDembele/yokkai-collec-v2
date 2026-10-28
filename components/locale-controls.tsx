"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition
} from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { dismissLocaleBanner, setLocalePreference } from "@/app/locale-actions";

export const LocalePreferenceContext = createContext({
  enabled: false,
  mode: "auto" as "auto" | "manual",
  dismissed: true
});

const languages = [
  { value: "fr", name: "Français" },
  { value: "en", name: "English" }
] as const;

function Flag({ locale }: { locale: string }) {
  if (locale === "fr")
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 3 2"
        preserveAspectRatio="xMidYMid slice"
      >
        <path fill="#002654" d="M0 0h1v2H0z" />
        <path fill="#fff" d="M1 0h1v2H1z" />
        <path fill="#ce1126" d="M2 0h1v2H2z" />
      </svg>
    );
  if (locale === "en")
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 60 30"
        preserveAspectRatio="xMidYMid slice"
      >
        <path fill="#012169" d="M0 0h60v30H0z" />
        <path stroke="#fff" strokeWidth="6" d="m0 0 60 30m0-30L0 30" />
        <path stroke="#c8102e" strokeWidth="2" d="m0 0 60 30m0-30L0 30" />
        <path stroke="#fff" strokeWidth="10" d="M30 0v30M0 15h60" />
        <path stroke="#c8102e" strokeWidth="6" d="M30 0v30M0 15h60" />
      </svg>
    );
  return null;
}

export function LocaleSelector({ full = false }: { full?: boolean }) {
  const preference = useContext(LocalePreferenceContext);
  const locale = useLocale();
  const t = useTranslations("locale");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  if (!preference.enabled) return null;
  const current =
    languages.find(language => language.value === locale)?.name ?? locale;
  const choose = (value: string) => {
    setOpen(false);
    trigger.current?.focus();
    if (value === locale) return;
    startTransition(async () => {
      try {
        const result = await setLocalePreference(value);
        setFailed(!result.ok);
        if (result.ok) router.refresh();
      } catch {
        setFailed(true);
      }
    });
  };
  return (
    <div
      ref={root}
      className={`yk-locale-selector${full ? " is-full" : ""}`}
      onKeyDown={event => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      {full && <span className="yk-locale-label">{t("language")}</span>}
      <button
        ref={trigger}
        type="button"
        className="yk-locale-trigger"
        aria-label={t("current", { language: current })}
        title={t("current", { language: current })}
        aria-expanded={open}
        aria-haspopup="true"
        disabled={pending}
        onClick={() => setOpen(value => !value)}
      >
        <span className="yk-locale-flag">
          <Flag locale={locale} />
        </span>
        {full && (
          <>
            <span>{current}</span>
            <svg
              aria-hidden="true"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="m7 10 5 5 5-5" />
            </svg>
          </>
        )}
      </button>
      {open && (
        <ul className="yk-locale-menu" aria-label={t("language")}>
          {languages.map(language => (
            <li key={language.value}>
              <button
                type="button"
                lang={language.value}
                aria-pressed={locale === language.value}
                onClick={() => choose(language.value)}
              >
                <span className="yk-locale-flag">
                  <Flag locale={language.value} />
                </span>
                {language.name}
                {locale === language.value && (
                  <svg
                    aria-hidden="true"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                  >
                    <path d="m5 12 5 5 9-10" />
                  </svg>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {failed && <span role="alert">{t("saveFailed")}</span>}
      {pending && (
        <span role="status" className="sr-only">
          {t("saving")}
        </span>
      )}
    </div>
  );
}

export function LocaleBanner() {
  const preference = useContext(LocalePreferenceContext);
  const locale = useLocale();
  const t = useTranslations("locale");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!preference.enabled) return;
    const refresh = () => router.refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [preference.enabled, router]);
  if (
    !preference.enabled ||
    preference.mode !== "auto" ||
    preference.dismissed ||
    locale === "en"
  )
    return null;
  return (
    <aside className="yk-locale-banner" aria-label={t("language")}>
      <span>{t("detected")}</span>
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            try {
              const result = await setLocalePreference(
                locale === "fr" ? "en" : "fr"
              );
              setFailed(!result.ok);
              if (result.ok) router.refresh();
            } catch {
              setFailed(true);
            }
          })
        }
      >
        {t("switchLanguage")}
      </button>
      <button
        disabled={pending}
        aria-label={t("dismiss")}
        onClick={() =>
          startTransition(async () => {
            try {
              await dismissLocaleBanner();
              router.refresh();
            } catch {
              setFailed(true);
            }
          })
        }
      >
        ×
      </button>
      {failed && <span role="alert">{t("saveFailed")}</span>}
    </aside>
  );
}
