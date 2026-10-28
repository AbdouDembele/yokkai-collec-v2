export const PRO_PROMOTION_KEY = "yokkai:pro-promotion:v1:dismissed-at";
export function proPromotionNextDay(now = Date.now()): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime();
}

export function proPromotionDismissed(
  value: string | null,
  now = Date.now()
): boolean {
  if (!value?.trim()) return false;
  const dismissedAt = Number(value);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return (
    Number.isFinite(dismissedAt) &&
    dismissedAt > 0 &&
    dismissedAt <= now &&
    dismissedAt >= today.getTime()
  );
}
