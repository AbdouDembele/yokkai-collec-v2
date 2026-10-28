"use client";
import { useTranslations } from "next-intl";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

function dismissalKey(userId: string) {
  return `yokkai-discord-promo-dismissed:${userId}`;
}

export function DiscordPromo({ enabled }: { enabled: boolean }) {
  const t = useTranslations("discordPromo");
  const pathname = usePathname();
  const isHome = pathname === "/" || pathname === "/design-system/home-preview";
  const [visible, setVisible] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || isHome) return;

    let active = true;
    const supabase = createClient();

    async function preparePromo() {
      const {
        data: { user }
      } = await supabase.auth.getUser();
      if (!active || !user) return;
      if (localStorage.getItem(dismissalKey(user.id)) === "1") return;

      setUserId(user.id);
      setVisible(true);
    }

    void preparePromo();
    return () => {
      active = false;
    };
  }, [enabled, isHome]);

  function dismiss() {
    if (userId) localStorage.setItem(dismissalKey(userId), "1");
    setVisible(false);
  }

  if (!visible || isHome) return null;

  return (
    <aside
      aria-label={t("yokkaiDiscordCommunity")}
      className={[
        "fixed right-4 bottom-4 z-[69] grid w-[min(calc(100vw-2rem),27rem)]",
        "grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-[18px]",
        "border border-[#5865f2]/45 bg-surface/95 px-4 py-2.5 backdrop-blur-md",
        "shadow-[0_14px_45px_rgba(0,0,0,0.55),0_0_28px_rgba(88,101,242,0.16)]",
        "max-sm:right-3 max-sm:bottom-24 max-sm:w-[calc(100vw-1.5rem)]"
      ].join(" ")}
    >
      <div className="min-w-0">
        <p className="truncate font-display text-sm font-bold tracking-wide text-ink">
          {t("joinTheYokkaiCommunity")}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-ink-3">
          {t("meetCollectorsTradeCardsAndFollowTheLatestNews")}
        </p>
      </div>
      <a
        href="/discord"
        target="_blank"
        rel="noopener noreferrer"
        className="yk-button yk-button-primary min-h-9 whitespace-nowrap !rounded-full px-5 py-2 text-xs"
      >
        {t("joinDiscord")}
      </a>
      <button
        type="button"
        aria-label={t("dismissDiscordInvitation")}
        onClick={dismiss}
        className="grid h-7 w-7 place-items-center rounded-full border border-veil text-base leading-none text-ink-3 transition hover:border-focus hover:bg-veil hover:text-ink"
      >
        ×
      </button>
    </aside>
  );
}
