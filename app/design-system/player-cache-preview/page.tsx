import { PlayerCacheProof } from "@/components/player-cache-proof";

export default async function PlayerCachePreviewPage({
  searchParams
}: {
  searchParams: Promise<{ disabled?: string }>;
}) {
  const disabled = (await searchParams).disabled === "1";
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10">
      <p className="eyebrow">Preuve fonctionnelle</p>
      <h1 className="yk-title mt-3">Cache des données joueur</h1>
      <p className="mt-4 text-sm text-ink-2">
        Deux lectures simultanées sont dédupliquées. La Collection expire après
        10 secondes, le solde après 60 secondes. Ajoute <code>?disabled=1</code>{" "}
        pour la contre-preuve.
      </p>
      <div className="mt-8">
        <PlayerCacheProof disabled={disabled} />
      </div>
    </main>
  );
}
