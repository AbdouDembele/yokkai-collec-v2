"use client";
import { useTranslations } from "next-intl";

import { useState } from "react";
import { CardShell } from "@/components/card-shell";
import { YokaiCard } from "@/components/yokai-card";
import { AUTH_BINDER_CARDS as cards } from "@/lib/auth/binder-preview-cards";
import "@/styles/auth-binder.css";

const ownedCount = cards.filter(card => card.owned).length;

export function AuthBinderShowcase() {
  const t = useTranslations("authBinderShowcase");
  const [pinned, setPinned] = useState(true);

  return (
    <section
      className="yk-auth-binder-demo"
      aria-label={t("narutoBinderPreview")}
    >
      <header className="yk-auth-binder-demo-header">
        <div>
          <span className="yk-auth-preview-label">{t("binder")}</span>
          <h4>Naruto</h4>
        </div>
        <div className="yk-auth-binder-demo-summary">
          <strong>
            {t("binderProgress", { owned: ownedCount, total: cards.length })}
          </strong>
          <button
            type="button"
            aria-label={pinned ? t("unpinNarutoBinder") : t("pinNarutoBinder")}
            aria-pressed={pinned}
            onClick={() => setPinned(current => !current)}
          >
            <span aria-hidden="true">{pinned ? "★" : "☆"}</span>
          </button>
        </div>
      </header>
      <div
        className="yk-auth-binder-demo-progress"
        role="progressbar"
        aria-label={t("exampleNarutoBinderCompletion")}
        aria-valuemin={0}
        aria-valuemax={cards.length}
        aria-valuenow={ownedCount}
      >
        <span style={{ width: `${(ownedCount / cards.length) * 100}%` }} />
      </div>
      <div className="yk-auth-binder-demo-controls">
        <label className="yk-auth-binder-demo-search">
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
          >
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m16 16 4.5 4.5" />
          </svg>
          <span className="sr-only">{t("searchTheExampleNarutoBinder")}</span>
          <input type="search" disabled placeholder={t("searchCards")} />
        </label>
        <button type="button" className="yk-auth-binder-demo-toggle" disabled>
          <span aria-hidden="true">○</span>
          {t("hideMissingCards")}
        </button>
      </div>
      <ul
        className="yk-auth-binder-demo-grid"
        aria-label={t("exampleNarutoBinderCards")}
      >
        {cards.map(card => (
          <li
            key={card.id}
            data-owned={card.owned}
            aria-label={t("cardStatus", {
              cardName: card.name,
              owned: card.owned ? "yes" : "no"
            })}
          >
            <CardShell interactive={false}>
              <YokaiCard
                {...card}
                animated={false}
                className={card.owned ? "" : "yk-panini-missing-card"}
              />
            </CardShell>
            <span className="yk-auth-binder-demo-card-status">
              {card.owned ? t("collected") : t("missing")}
            </span>
          </li>
        ))}
      </ul>
      <p className="yk-auth-binder-demo-note">
        {t("illustrativeBinderCollectedCardsStandOutMissingCardsStayVisible")}
      </p>
    </section>
  );
}
