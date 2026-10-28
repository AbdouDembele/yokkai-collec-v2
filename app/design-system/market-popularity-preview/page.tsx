import type { Metadata } from "next";
import { MarketPopularityProof } from "@/components/market-popularity-proof";

export const metadata: Metadata = {
  title: "Market popularity proof",
  robots: { index: false, follow: false }
};
export default async function Page({
  searchParams
}: {
  searchParams: Promise<{ disabled?: string }>;
}) {
  const disabled = (await searchParams).disabled === "1";
  return (
    <main className="mx-auto w-full max-w-[var(--layout-collection-max)] px-6 py-10">
      <p className="eyebrow">Test d’intégration</p>
      <h1 className="yk-title mt-3">Tri du Marché par popularité</h1>
      <p className="mt-4 text-sm text-ink-2">
        La vraie vue Marché trie les scores issus de{" "}
        <code>cards.favoris_count</code>. La variante <code>?disabled=1</code>{" "}
        neutralise uniquement ces scores.
      </p>
      <div className="mt-8">
        <MarketPopularityProof disabled={disabled} />
      </div>
    </main>
  );
}
