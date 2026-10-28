import { TradePollingProof } from "@/components/trade-polling-proof";

export default async function TradePollingPreview({
  searchParams
}: {
  searchParams: Promise<{ disabled?: string; offre?: string }>;
}) {
  return (
    <main className="mx-auto w-full max-w-[var(--layout-collection-max)] px-6 py-10">
      <p className="eyebrow">Preuve fonctionnelle</p>
      <h1 className="yk-title mt-3">
        Réconciliation des échanges entre deux comptes
      </h1>
      <p className="mt-4 text-sm text-ink-2">
        Le destinataire accepte. Le proposeur reste en attente jusqu’au cycle
        suivant, puis voit l’acceptation sans rechargement. Ajoute{" "}
        <code>?disabled=1</code> pour neutraliser le polling du proposeur.
      </p>
      <div className="mt-8">
        <TradePollingProof
          initialOfferId={(await searchParams).offre}
          disabled={(await searchParams).disabled === "1"}
        />
      </div>
    </main>
  );
}
