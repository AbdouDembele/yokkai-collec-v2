/**
 * @param {{ position: number | null, topPercent: number | null } | null | undefined} rank
 * @returns {string | null}
 */
export function referralRankLabel(rank) {
  if (!rank?.position || rank.position < 1) return null;
  if (rank.position <= 500)
    return `Top ${rank.position.toLocaleString("en-US")}`;
  return rank.topPercent == null ? null : `Top ${rank.topPercent}%`;
}
