import { AuctionSuggestionProof } from "@/components/auction-suggestion-proof";

export default async function AuctionSuggestionPreviewPage({
  searchParams
}: {
  searchParams: Promise<{ disabled?: string }>;
}) {
  const disabled = (await searchParams).disabled === "1";
  return (
    <main className="yk-page yk-collection">
      <header className="yk-page-heading">
        <div>
          <p className="yk-eyebrow">Preuve fonctionnelle</p>
          <h1>Suggestion de prix d’enchère</h1>
          <p>
            Ouvre la carte puis la modale de vente. Ajoute{" "}
            <code>?disabled=1</code> pour la contre-preuve sans valeur de
            marché.
          </p>
        </div>
      </header>
      <AuctionSuggestionProof disabled={disabled} />
    </main>
  );
}
