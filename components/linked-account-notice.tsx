"use client";

import { useTranslations } from "next-intl";

import { useEffect, useState } from "react";
import {
  isOAuthProvider,
  OAUTH_LINKED_COOKIE,
  OAUTH_PROVIDER_NAMES,
  type OAuthProvider
} from "@/lib/auth/oauth";

// One-time notice after GoTrue linked a provider to an existing account.
export function LinkedAccountNotice() {
  const t = useTranslations("authForm");
  const [provider, setProvider] = useState<OAuthProvider>();
  useEffect(() => {
    const value = document.cookie
      .split("; ")
      .find(entry => entry.startsWith(`${OAUTH_LINKED_COOKIE}=`))
      ?.slice(OAUTH_LINKED_COOKIE.length + 1);
    if (!value) return;
    document.cookie = `${OAUTH_LINKED_COOKIE}=; path=/; max-age=0`;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from a cookie on mount.
    if (isOAuthProvider(value)) setProvider(value);
  }, []);
  if (!provider) return null;
  const name = OAUTH_PROVIDER_NAMES[provider];
  return (
    <div role="status" className="yk-linked-notice">
      <p>{t("providerLinked", { provider: name })}</p>
      <button
        type="button"
        onClick={() => setProvider(undefined)}
        aria-label={t("dismissLinkedNotice")}
      >
        ×
      </button>
    </div>
  );
}
