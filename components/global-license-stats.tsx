"use client";
import { useTranslations } from "next-intl";

export function GlobalLicenseStats({
  completionScore,
  completed,
  cards,
  totalLicenses,
  totalCards,
  compact = false
}: {
  completionScore?: number;
  completed: number;
  cards: number;
  totalLicenses: number;
  totalCards: number;
  compact?: boolean;
}) {
  const t = useTranslations("communityRanking");
  if (completionScore !== undefined)
    return (
      <dl className={`yk-ranking-global-stats${compact ? " is-compact" : ""}`}>
        <div data-global-stat="score">
          <dt>{t("completionScore")}</dt>
          <dd>{t("completionPoints", { count: completionScore })}</dd>
        </div>
        <div data-global-stat="completed">
          <dt>{t("completedStat")}</dt>
          <dd>{t("ratio", { owned: completed, total: totalLicenses })}</dd>
          <progress
            value={completed}
            max={totalLicenses || 1}
            aria-label={t("completedStat")}
          />
        </div>
      </dl>
    );
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
