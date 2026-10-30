"use client";
import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { RankingChoice } from "@/components/ranking-choice";
import {
  getPaniniAlbumsPage,
  type PaniniAlbumProgress
} from "@/lib/data/cards";
import { binderIdentity } from "@/lib/ui/binder-identity";
import { normalizeChoiceLabel } from "@/lib/ui/select-typeahead";
const licenseLabel = (item: PaniniAlbumProgress) => item.license;
export function LicenseRankingChoice({
  items,
  selected,
  loading,
  hasMore,
  onLoadMore,
  onSelect,
  category = "",
  query = ""
}: {
  items: PaniniAlbumProgress[];
  selected: PaniniAlbumProgress | null;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onSelect: (item: PaniniAlbumProgress) => void;
  category?: string;
  query?: string;
}) {
  const t = useTranslations("communityRanking");
  const findMatch = useCallback(
    async (prefix: string, signal: AbortSignal) => {
      // Search the same category/filter with bounded pages, without changing the
      // visible search field or loading the whole catalogue just to open a menu.
      for (let page = 1; !signal.aborted; page++) {
        const next = await getPaniniAlbumsPage({
          query: query || prefix,
          category,
          page,
          pageSize: 72
        });
        if (signal.aborted) return null;
        const match = next.items.find(item =>
          normalizeChoiceLabel(item.license).startsWith(prefix)
        );
        if (match) return match;
        if (!next.items.length || page * 72 >= next.total) return null;
      }
      return null;
    },
    [category, query]
  );
  return (
    <RankingChoice
      id="ranking-license-select"
      labelId="ranking-license-label"
      items={items}
      selected={selected}
      getKey={binderIdentity}
      getLabel={licenseLabel}
      placeholder={t("chooseLicense")}
      loading={loading}
      hasMore={hasMore}
      onLoadMore={onLoadMore}
      onSelect={onSelect}
      findMatch={hasMore ? findMatch : undefined}
      loadingLabel={t("selectionLoading")}
      emptyLabel={t("noLicenses")}
      errorLabel={t("selectionFailed")}
    />
  );
}
