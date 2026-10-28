import { BoosterOpeningPreview } from "@/components/booster-opening-preview";

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <p className="eyebrow">Design system · preuve sans RPC</p>
      <h1 className="yk-title mt-3">Ouverture fluide d’un booster</h1>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-ink-2">
        Choisis une latence, puis ouvre le Booster Régulier. La mesure part du
        clic et s’arrête lorsque l’écran de reveal devient visible.
      </p>
      <BoosterOpeningPreview />
    </main>
  );
}
