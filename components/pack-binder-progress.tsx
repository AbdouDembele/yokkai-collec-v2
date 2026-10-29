"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  getPackBinderGains,
  type PackBinderGain
} from "@/lib/data/binder-discovery";
import type { Card } from "@/lib/data/cards";
import { binderHref } from "@/lib/ui/binder-discovery";
import { binderIdentity } from "@/lib/ui/binder-identity";
import "@/styles/binder-discovery.css";
export function PackBinderProgress({
  cards,
  load = getPackBinderGains
}: {
  cards: Card[];
  load?: typeof getPackBinderGains;
}) {
  const t = useTranslations("binderDiscovery");
  const [progress, setProgress] = useState<{
    key: string;
    gains: PackBinderGain[];
  } | null>(null);
  const key = cards
    .map(card => card.id)
    .sort()
    .join(",");
  useEffect(() => {
    let active = true;
    if (!key) return;
    void load(cards).then(
      gains => {
        if (active) setProgress({ key, gains });
      },
      () => {}
    );
    return () => {
      active = false;
    };
    // The card IDs define an opening, even if the reveal component re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, load]);
  const gains = progress?.key === key ? progress.gains : [];
  if (!gains.length) return null;
  return (
    <section
      className="yk-pack-binder-progress"
      aria-labelledby="pack-binders-title"
    >
      <h3 id="pack-binders-title">{t("packTitle")}</h3>
      <ul>
        {gains.map(gain => (
          <li key={binderIdentity(gain)}>
            <Link href={binderHref(gain)}>
              <span>
                <strong>{gain.license}</strong>
                <small>{t("newForBinder", { count: gain.added })}</small>
              </span>
              <span className="yk-pack-binder-count">
                {t("count", { owned: gain.owned, total: gain.total })}
                <span aria-hidden="true"> ↗</span>
              </span>
              <progress
                value={gain.owned}
                max={gain.total}
                aria-label={t("progressFor", { name: gain.license })}
              />
              <small className="yk-pack-binder-cards">
                {cards
                  .filter(card => gain.cardIds.includes(card.id))
                  .map(card => card.name)
                  .join(" · ")}
              </small>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
