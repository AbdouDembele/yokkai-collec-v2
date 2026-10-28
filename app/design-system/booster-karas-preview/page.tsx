import type { Metadata } from "next";
import { BoosterKarasProof } from "@/components/booster-karas-proof";

export const metadata: Metadata = {
  title: "Booster Karas proof",
  robots: { index: false, follow: false }
};
export default async function Page({
  searchParams
}: {
  searchParams: Promise<{ disabled?: string }>;
}) {
  const disabled = (await searchParams).disabled === "1";
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <p className="eyebrow">Test d’intégration</p>
      <h1 className="yk-title mt-3">Gains Karas avant confirmation</h1>
      <p className="mt-4 text-sm text-ink-2">
        Les deux vraies vues de reveal reçoivent les valeurs autoritaires. La
        variante <code>?disabled=1</code> retire uniquement ces valeurs.
      </p>
      <div className="mt-8">
        <BoosterKarasProof disabled={disabled} />
      </div>
    </main>
  );
}
