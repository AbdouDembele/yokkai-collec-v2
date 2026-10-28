import type { LeaderboardCardCounts } from "@/lib/leaderboard/shared";

type StatKind = "cards" | "infinity" | "shiny";

export function LeaderboardRarityBadge({ rarity }: { rarity: string }) {
  return (
    <span className="yk-leaderboard-rarity" data-rarity={rarity}>
      {rarity}
    </span>
  );
}

export function LeaderboardStatIcon({ kind }: { kind: StatKind }) {
  return (
    <span className={`yk-leaderboard-stat-icon is-${kind}`} aria-hidden="true">
      {kind === "infinity" ? (
        <svg
          viewBox="0 4 24 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 16c5 0 7-8 12-8a4 4 0 0 1 0 8c-5 0-7-8-12-8a4 4 0 1 0 0 8Z" />
        </svg>
      ) : kind === "shiny" ? (
        "✦"
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="8" y="6" width="12" height="15" rx="2" />
          <path d="M16 6V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2" />
        </svg>
      )}
    </span>
  );
}

export function LeaderboardStats({
  counts
}: {
  counts?: LeaderboardCardCounts;
}) {
  return (
    <span className="yk-leaderboard-stats">
      {(["sr", "ssr", "lr"] as const).map(rarity => (
        <span key={rarity} className={`yk-leaderboard-stat is-${rarity}`}>
          <LeaderboardRarityBadge rarity={rarity.toUpperCase()} />
          <b>{counts?.[rarity].toLocaleString("en-US") ?? "—"}</b>
        </span>
      ))}
      {(
        [
          ["infinity", counts?.infinity, "Infinity"],
          ["shiny", counts?.shiny, "Shiny"]
        ] as const
      ).map(([kind, count, label]) => (
        <span key={kind} className={`yk-leaderboard-stat is-${kind}`}>
          <LeaderboardStatIcon kind={kind} />
          <span>
            <b>{count?.toLocaleString("en-US") ?? "—"}</b> {label}
          </span>
        </span>
      ))}
    </span>
  );
}
