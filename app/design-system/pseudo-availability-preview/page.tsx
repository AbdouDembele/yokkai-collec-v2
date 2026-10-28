import { PseudoAvailabilityProof } from "@/components/pseudo-availability-proof";

export default async function PseudoAvailabilityPreviewPage({
  searchParams
}: {
  searchParams: Promise<{ disabled?: string }>;
}) {
  const disabled = (await searchParams).disabled === "1";
  return (
    <main className="yk-auth-page">
      <section className="yk-auth-panel">
        <div className="yk-auth-copy">
          <p className="yk-eyebrow">Preuve fonctionnelle</p>
          <h1>Disponibilité du pseudo</h1>
          <p>
            La vérification informative attend 450 ms. Ajoute{" "}
            <code>?disabled=1</code> pour la contre-preuve.
          </p>
        </div>
        <PseudoAvailabilityProof disabled={disabled} />
      </section>
    </main>
  );
}
