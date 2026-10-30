"use client";
import { useTranslations } from "next-intl";

export function GlobalLicenseStats({
  completed,
  cards,
  totalLicenses,
  totalCards,
  compact = false
}: {
  completed: number;
  cards: number;
  totalLicenses: number;
  totalCards: number;
  compact?: boolean;
}) {
  const t = useTranslations("communityRanking");
  return (
    <dl className={`yk-ranking-global-stats${compact ? " is-compact" : ""}`}>
      {(
        [
          {
            key: "completed",
            label: "completedStat",
            value: completed,
            total: totalLicenses
          },
          { key: "cards", label: "cardsStat", value: cards, total: totalCards }
        ] as const
      ).map(stat => (
        <div key={stat.key} data-global-stat={stat.key}>
          <dt>{t(stat.label)}</dt>
          <dd>{t("ratio", { owned: stat.value, total: stat.total })}</dd>
          <progress
            value={stat.value}
            max={stat.total || 1}
            aria-label={t(stat.label)}
          />
        </div>
      ))}
    </dl>
  );
}
