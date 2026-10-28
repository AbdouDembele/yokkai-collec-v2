import type { AdminPlayer, AdminPlayerDetail } from "./player-manager";

export function playerFromRpc(value: Record<string, unknown>): AdminPlayer {
  return {
    userId: String(value.userId ?? ""),
    pseudo: String(value.pseudo ?? "Player"),
    email: String(value.email ?? ""),
    createdAt: String(value.createdAt ?? ""),
    lastSeenAt: typeof value.lastSeenAt === "string" ? value.lastSeenAt : null,
    cardsCount: Number(value.cardsCount ?? 0),
    karasBalance: Number(value.karasBalance ?? 0),
    isBanned: value.isBanned === true,
    isAdmin: value.isAdmin === true
  };
}

export function playerDetailFromRpc(
  value: Record<string, unknown> | null
): AdminPlayerDetail | null {
  if (!value) return null;
  return {
    ...playerFromRpc(value),
    cards: Array.isArray(value.cards)
      ? value.cards.map(card => {
          const item = card as Record<string, unknown>;
          return {
            instanceId: String(item.instanceId),
            cardId: String(item.cardId),
            name: String(item.name),
            category: String(item.category),
            franchise: String(item.franchise ?? ""),
            rarity: String(item.rarity) as "C" | "R" | "SR" | "SSR" | "LR",
            imageUrl: String(item.imageUrl),
            catalogueImage: String(item.catalogueImage),
            customImageUrl:
              typeof item.customImageUrl === "string"
                ? item.customImageUrl
                : null,
            obtainedAt: String(item.obtainedAt),
            shiny: item.shiny === true,
            evolved: item.evolved === true,
            firstOwner: item.firstOwner === true,
            locked: item.locked === true,
            activeAuctionId:
              typeof item.activeAuctionId === "string"
                ? item.activeAuctionId
                : null
          };
        })
      : []
  };
}
