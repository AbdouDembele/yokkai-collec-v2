import type { Metadata } from "next";
import { MultiTermSearchProof } from "@/components/multi-term-search-proof";

export const metadata: Metadata = {
  title: "Multi-term search proof",
  robots: { index: false, follow: false }
};
export default function Page() {
  return (
    <main className="mx-auto w-full max-w-[var(--layout-collection-max)] px-6 py-10">
      <p className="eyebrow">Test d’intégration</p>
      <h1 className="yk-title mt-3">Recherche multi-termes</h1>
      <p className="mt-4 text-sm text-ink-2">
        Les vraies vues Collection, Catalogue et Marché sont montées avec les
        mêmes cartes locales. Des frappes navigateur vérifient les termes
        répartis entre nom et franchise, dans les deux ordres.
      </p>
      <div className="mt-8">
        <MultiTermSearchProof />
      </div>
    </main>
  );
}
