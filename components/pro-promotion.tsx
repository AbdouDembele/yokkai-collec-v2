"use client";
import { useTranslations } from "next-intl";

import Link from "next/link";
import { Button, Modal } from "@/components/ui";
import { useEffect, useState } from "react";
import { useProMembershipStatus } from "@/components/pro-access";
import {
  PRO_PROMOTION_KEY,
  proPromotionDismissed,
  proPromotionNextDay
} from "@/lib/ui/pro-promotion";
import "@/styles/pro-promotion.css";

export function ProPromotionBanner({
  onDismiss,
  page = "home"
}: {
  onDismiss?: () => void;
  page?: "home" | "packs";
}) {
  const t = useTranslations("proPromotion");
  return (
    <aside
      className="yk-pro-promo"
      data-page={page}
      aria-label={t("discoverYokkaiPro")}
    >
      <div className="yk-pro-promo-emblem" aria-hidden="true">
        <svg viewBox="0 0 48 48" fill="none">
          <path
            d="M24 4 29 19 44 24 29 29 24 44 19 29 4 24 19 19Z"
            fill="currentColor"
          />
          <path
            d="m37 5 1.5 4.5L43 11l-4.5 1.5L37 17l-1.5-4.5L31 11l4.5-1.5Z"
            fill="currentColor"
            opacity=".55"
          />
        </svg>
      </div>
      <div className="yk-pro-promo-copy">
        <p className="yk-pro-promo-eyebrow">
          <span>{t("yokkaiPro")}</span> {t("yourCollectionUpgraded")}
        </p>
        <h2>
          {t("makeItYours")}
          <span>{t("makeItPro")}</span>
        </h2>
        <p className="yk-pro-promo-description">
          {t("yourImagesYourGifsACollectionWithYourSignature")}
        </p>
        <ul aria-label={t("proHighlights")}>
          <li>{t("customCardArtwork")}</li>
          <li>{t("fasterPacks")}</li>
          <li>{t("moreRoomToCollect")}</li>
        </ul>
      </div>
      <Link href="/premium" className="yk-pro-promo-link">
        {t("explorePro")}
        <span aria-hidden="true">↗</span>
      </Link>
      {onDismiss && (
        <button
          type="button"
          className="yk-pro-promo-dismiss"
          onClick={onDismiss}
          aria-label={t("hideProPromotionUntilTomorrow")}
          title={t("hideUntilTomorrow")}
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      )}
    </aside>
  );
}

export function ProPromotion({
  enabled = true,
  dismissible = true,
  compact = false,
  page = "home"
}: {
  enabled?: boolean;
  dismissible?: boolean;
  compact?: boolean;
  page?: "home" | "packs";
}) {
  const t = useTranslations("proPromotion");
  const membership = useProMembershipStatus();
  const [choicesOpen, setChoicesOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!enabled || !dismissible || membership !== false) return;
    let rollover: number | undefined;
    const readPreference = () => {
      try {
        setVisible(
          !proPromotionDismissed(localStorage.getItem(PRO_PROMOTION_KEY))
        );
      } catch {
        setVisible(true);
      }
      window.clearTimeout(rollover);
      rollover = window.setTimeout(
        readPreference,
        Math.max(1, proPromotionNextDay() - Date.now())
      );
    };
    const timer = window.setTimeout(readPreference, 600);
    const syncPreference = (event: StorageEvent) => {
      if (event.key === PRO_PROMOTION_KEY || event.key === null)
        readPreference();
    };
    window.addEventListener("storage", syncPreference);
    const resume = () => {
      if (document.visibilityState === "visible") readPreference();
    };
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(rollover);
      window.removeEventListener("storage", syncPreference);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [enabled, dismissible, membership]);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(PRO_PROMOTION_KEY, String(Date.now()));
    } catch {
      /* Closing still works when browser storage is unavailable. */
    }
  }
  if (!enabled || membership !== false || (dismissible && !visible))
    return null;
  if (compact)
    return (
      <>
        <div className="mt-6 flex justify-center">
          <Button onClick={() => setChoicesOpen(true)}>
            {t("getMorePacks")}
          </Button>
        </div>
        <Modal
          open={choicesOpen}
          onClose={() => setChoicesOpen(false)}
          title={t("getMorePacks")}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <section className="rounded-panel border border-veil p-5">
              <h3 className="font-display text-xl">{t("inviteFriends")}</h3>
              <p className="my-4 text-sm text-ink-2">
                {t("earn5BonusPacksWhenYourFriendVerifiesTheirEmail")}
              </p>
              <Link
                href="/settings#referrals"
                className="yk-button yk-button-secondary"
              >
                {t("getInviteLink")}
              </Link>
            </section>
            <section className="rounded-panel border border-veil p-5">
              <h3 className="font-display text-xl">{t("getPro")}</h3>
              <p className="my-4 text-sm text-ink-2">
                {t("refillYourPacksFasterWithYokkaiPro")}
              </p>
              <Link href="/premium" className="yk-button yk-button-primary">
                {t("exploreProLabel")}
              </Link>
            </section>
          </div>
        </Modal>
      </>
    );
  return (
    <ProPromotionBanner
      page={page}
      onDismiss={dismissible ? dismiss : undefined}
    />
  );
}
