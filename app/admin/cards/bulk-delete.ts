// Mirrors the hard cap enforced by public.admin_bulk_card_ids (SQL is authoritative).
export const MAX_BULK_DELETE_CARDS = 500;

export type BulkDeletePreview = {
  cards: number;
  ownedCopies: number;
  activeAuctions: number;
  pendingTrades: number;
  cardShares: number;
  wishlists: number;
  multiFranchiseCards: { id: string; name: string; franchises: string[] }[];
};
