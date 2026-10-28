"use client";
import { useLocale, useTranslations } from "next-intl";

import Script from "next/script";
import { useCallback, useEffect, useId, useRef, useState } from "react";

type TurnstileApi = {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      theme: "auto";
      size: "flexible";
      language: "en" | "fr";
      callback(): void;
      "expired-callback"(): void;
      "timeout-callback"(): void;
      "error-callback"(): void;
    }
  ): string;
  reset(id: string): void;
  remove(id: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function AuthTurnstile() {
  const t = useTranslations("authTurnstile");
  const locale = useLocale();
  const id = useId();
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const configuredSupport = process.env.NEXT_PUBLIC_AUTH_SUPPORT_URL;
  let supportUrl: string | undefined;
  try {
    const url = new URL(configuredSupport ?? "");
    if (url.protocol === "https:" && !url.username && !url.password)
      supportUrl = url.href;
  } catch {
    /* An absent/invalid support URL must not create an unsafe link. */
  }
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string>(undefined);
  const [error, setError] = useState("");

  const renderWidget = useCallback(() => {
    if (
      !siteKey ||
      !container.current ||
      !window.turnstile ||
      widget.current !== undefined
    )
      return;
    try {
      widget.current = window.turnstile.render(container.current, {
        sitekey: siteKey,
        theme: "auto",
        size: "flexible",
        language: locale === "fr" ? "fr" : "en",
        callback: () => setError(""),
        "expired-callback": () => {
          if (widget.current !== undefined)
            window.turnstile?.reset(widget.current);
          setError("expired");
        },
        "timeout-callback": () => {
          if (widget.current !== undefined)
            window.turnstile?.reset(widget.current);
          setError("timeout");
        },
        "error-callback": () => setError("browserUnavailable")
      });
    } catch {
      setError("unavailable");
    }
  }, [siteKey, locale]);

  useEffect(() => {
    const form = container.current?.closest("form");
    if (!siteKey || !form) return;
    renderWidget();
    const reset = () => {
      if (widget.current !== undefined) window.turnstile?.reset(widget.current);
    };
    // formdata is emitted after the payload is captured: clearing the DOM here
    // preserves that one submission while preventing a retry with its old token.
    form.addEventListener("formdata", reset);
    form.addEventListener("reset", reset);
    return () => {
      form.removeEventListener("formdata", reset);
      form.removeEventListener("reset", reset);
      if (widget.current !== undefined)
        window.turnstile?.remove(widget.current);
      widget.current = undefined;
    };
  }, [siteKey, renderWidget]);

  if (!siteKey) return null;
  return (
    <div className="grid gap-2">
      <p className="text-sm">
        {t("botVerificationSupportsKeyboardNavigationNoVisualPuzzleIsRequired")}
      </p>
      <div ref={container} />
      <Script
        id={"auth-turnstile-" + id}
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        onLoad={renderWidget}
        onReady={renderWidget}
        onError={() => setError("loadFailed")}
      />
      {error && (
        <p role="alert" className="auth-error">
          {t(error)}
        </p>
      )}
      <button
        type="button"
        className="yk-auth-link text-sm"
        onClick={() => {
          if (!window.turnstile) {
            window.location.reload();
            return;
          }
          if (widget.current !== undefined)
            window.turnstile.reset(widget.current);
          else renderWidget();
          setError("");
        }}
      >
        {t("retryVerification")}
      </button>
      {supportUrl && (
        <a
          href={supportUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="yk-auth-link text-sm"
        >
          {t("canTCompleteVerificationGetHelpFromTheTeam")}
        </a>
      )}
      <noscript>
        {t("enableJavascriptToUseThisAccessibleVerificationIfYouStill")}
      </noscript>
    </div>
  );
}
