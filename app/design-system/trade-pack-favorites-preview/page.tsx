import { TradePackFavoritesPreview } from "@/components/trade-pack-favorites-preview";
export default async function Page({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  return (
    <TradePackFavoritesPreview
      kind={search.kind === "trade" ? "trade" : "pack"}
      count={search.count === "3" ? 3 : search.count === "5" ? 5 : 50}
    />
  );
}
