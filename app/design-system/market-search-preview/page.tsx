import type { Metadata } from "next";
import { MarketSearchProof } from "@/components/market-search-proof";

export const metadata: Metadata = {
  title: "Market search proof",
  robots: { index: false, follow: false }
};
export default function Page() {
  return (
    <main className="mx-auto w-full max-w-[var(--layout-collection-max)] px-6 py-10">
      <p className="eyebrow">Test d’intégration</p>
      <h1 className="yk-title mt-3">Recherche dans le Marché</h1>
      <p className="mt-4 text-sm text-ink-2">
        La vraie vue Marché est montée avec des enchères locales. La barre de
        recherche, la rareté et les tris sont manipulés dans le navigateur, sans
        RPC.
      </p>
      <div className="mt-8">
        <MarketSearchProof />
      </div>
    </main>
  );
}
