import { DirectInvalidationProof } from "@/components/direct-invalidation-proof";

export default async function DirectInvalidationPreview({
  searchParams
}: {
  searchParams: Promise<{ disabled?: string }>;
}) {
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <p className="eyebrow">Preuve fonctionnelle</p>
      <h1 className="yk-title mt-3">Actions et snapshots joueur</h1>
      <p className="mt-4 text-sm text-ink-2">
        Chaque bouton simule le succès RPC correspondant puis publie exactement
        les portées de la mutation. Ajoute <code>?disabled=1</code> pour
        neutraliser le câblage.
      </p>
      <div className="mt-8">
        <DirectInvalidationProof
          disabled={(await searchParams).disabled === "1"}
        />
      </div>
    </main>
  );
}
