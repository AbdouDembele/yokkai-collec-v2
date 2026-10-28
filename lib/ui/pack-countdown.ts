// Shared by the booster screen and home; availability always comes from SQL.
export function packCountdown(
  nextPackAt: number | null | undefined,
  now: number,
  hours = false
) {
  const seconds = nextPackAt
    ? Math.max(0, Math.ceil((nextPackAt - now) / 1000))
    : 0;
  const minutes = hours
    ? Math.floor((seconds % 3600) / 60)
    : Math.floor(seconds / 60);
  const prefix = hours
    ? `${Math.floor(seconds / 3600)
        .toString()
        .padStart(2, "0")}:`
    : "";
  return `${prefix}${minutes
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export function auctionCountdown(endsAt: number, now: number) {
  const seconds = Math.max(0, Math.ceil((endsAt - now) / 1000));
  if (seconds < 3600) return packCountdown(endsAt, now);
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
