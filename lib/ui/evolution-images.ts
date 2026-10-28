import type { CollectedCard } from "@/lib/data/cards";

// The database inherits the first custom image in the validated copy order.
// Keep the preview, suggested selection and submitted order in agreement.
export function orderEvolutionCopies(
  copies: CollectedCard[],
  preferredInstanceId?: string | null
): CollectedCard[] {
  const imageSource =
    copies.find(
      card => card.instanceId === preferredInstanceId && card.customImageUrl
    ) ?? copies.find(card => card.customImageUrl);
  return imageSource
    ? [
        imageSource,
        ...copies.filter(card => card.instanceId !== imageSource.instanceId)
      ]
    : [...copies];
}
