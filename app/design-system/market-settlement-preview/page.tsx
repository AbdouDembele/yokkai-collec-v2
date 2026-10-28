import { MarketSettlementProof } from "@/components/market-settlement-proof";

export default async function MarketSettlementPreview({
  searchParams
}: {
  searchParams: Promise<{ disabled?: string }>;
}) {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <p className="eyebrow">Preuve fonctionnelle</p>
      <h1 className="yk-title mt-3">Règlement du Marché entre deux acteurs</h1>
      <p className="mt-4 text-sm text-ink-2">
        Un acteur déclenche une vente, une victoire et une surenchère. L’autre
        compte reste inchangé jusqu’au prochain cycle, puis réconcilie les
        portées une seule fois. Ajoute <code>?disabled=1</code> pour la
        contre-preuve.
      </p>
      <div className="mt-8">
        <MarketSettlementProof
          disabled={(await searchParams).disabled === "1"}
        />
      </div>
    </main>
  );
}
