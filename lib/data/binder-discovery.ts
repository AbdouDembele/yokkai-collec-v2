import {
  getPaniniAlbumsPage,
  getPaniniAlbumCardsPage,
  type Card,
  type PaniniAlbumProgress
} from "@/lib/data/cards";
import { stableBindersEnabled, withBinderMetadata } from "@/lib/data/binders";
import { binderHighlights } from "@/lib/ui/binder-discovery";
import { binderIdentity } from "@/lib/ui/binder-identity";

export type BinderHighlight = PaniniAlbumProgress & { image?: string };
export type PackBinderGain = BinderHighlight & {
  cardIds: string[];
  added: number;
};
export type BinderDiscoveryAdapter = {
  albums: typeof getPaniniAlbumsPage;
  cards: typeof getPaniniAlbumCardsPage;
  enrich: (cards: Card[]) => Promise<Card[]>;
  stable: () => boolean;
};
export const liveBinderDiscovery: BinderDiscoveryAdapter = {
  albums: getPaniniAlbumsPage,
  cards: getPaniniAlbumCardsPage,
  enrich: withBinderMetadata,
  stable: stableBindersEnabled
};
export async function getHomeBinders(
  adapter = liveBinderDiscovery
): Promise<BinderHighlight[]> {
  // Fetch a bounded candidate page (favorites, then community popularity); the Home selects personal progress highlights.
  const page = await adapter.albums({ page: 1, pageSize: 72 });
  return Promise.all(
    binderHighlights(page.items).map(async album => {
      if (album.image?.trim()) return album;
      try {
        const cover = await adapter.cards({
          license: binderIdentity(album),
          pageSize: 1,
          ownedOnly: album.owned > 0
        });
        return { ...album, image: cover.items[0]?.image };
      } catch {
        return album;
      }
    })
  );
}
export async function getPackBinderGains(
  cards: Card[],
  adapter = liveBinderDiscovery
): Promise<PackBinderGain[]> {
  const unique = [...new Map(cards.map(card => [card.id, card])).values()];
  if (!unique.length) return [];
  // Opening already enriched these exact card identities. Keep fallback enrichment
  // for old responses without metadata, without caching memberships across openings.
  const enriched = adapter === liveBinderDiscovery && adapter.stable() &&
    unique.every(card => card.binders !== undefined)
    ? unique : await adapter.enrich(unique);
  const groups = new Map<
    string,
    { license: string; binderKey?: string; cardIds: string[] }
  >();
  for (const card of enriched) {
    const binders = adapter.stable()
      ? (card.binders ?? []).map(b => ({ key: b.key, name: b.name }))
      : [
          {
            key: card.anime?.trim() || card.category.trim(),
            name: card.anime?.trim() || card.category.trim()
          }
        ];
    for (const b of binders) {
      if (!b.key) continue;
      const group = groups.get(b.key) ?? {
        license: b.name,
        binderKey: adapter.stable() ? b.key : undefined,
        cardIds: []
      };
      if (!group.cardIds.includes(card.id)) group.cardIds.push(card.id);
      groups.set(b.key, group);
    }
  }
  // A large opening still makes at most six progress requests; card IDs are deduplicated.
  const result = await Promise.all(
    [...groups.values()].slice(0, 6).map(async group => {
      try {
        const page = await adapter.cards({
          license: binderIdentity(group),
          pageSize: 1
        });
        let total = page.binderTotal,
          owned = page.binderOwned;
        if (typeof total !== "number" || typeof owned !== "number") {
          const albums = await adapter.albums({
            query: group.license,
            pageSize: 72
          });
          const match = albums.items.find(
            a => binderIdentity(a) === binderIdentity(group)
          );
          total = match?.total;
          owned = match?.owned;
        }
        if (
          typeof total !== "number" ||
          typeof owned !== "number" ||
          total <= 0
        )
          return null;
        return {
          ...group,
          total,
          owned,
          percent: Math.min(100, Math.round((owned * 100) / total)),
          favorite: false,
          added: group.cardIds.length,
          image: unique.find(card => group.cardIds.includes(card.id))?.image
        };
      } catch {
        return null;
      }
    })
  );
  return result.filter(
    (value): value is NonNullable<typeof value> => value !== null
  );
}
