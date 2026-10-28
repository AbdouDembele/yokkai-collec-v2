import type { Metadata } from "next";
import { CollectionSortProof } from "@/components/collection-sort-proof";

export const metadata: Metadata = {
  title: "Collection sort proof",
  robots: { index: false, follow: false }
};
export default function Page() {
  return (
    <main className="mx-auto w-full max-w-[var(--layout-collection-max)] px-6 py-10">
      <p className="eyebrow">Test d’intégration</p>
      <h1 className="yk-title mt-3">Tri de la Collection</h1>
      <p className="mt-4 text-sm text-ink-2">
        La vraie vue Collection est montée avec des cartes locales. Le sélecteur
        de tri, la pagination, la sélection multiple et les filtres sont
        manipulés dans le navigateur, puis la page est rechargée pour vérifier
        le tri mémorisé.
      </p>
      <div className="mt-8">
        <CollectionSortProof />
      </div>
    </main>
  );
}
