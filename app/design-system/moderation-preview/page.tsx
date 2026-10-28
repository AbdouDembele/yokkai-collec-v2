import type { Metadata } from "next";
import { ModerationProof } from "@/components/moderation-proof";

export const metadata: Metadata = {
  title: "Blocage et signalement : preuve",
  robots: { index: false, follow: false }
};
export default function Page() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="yk-title">Blocage et signalement</h1>
      <p className="my-6 text-ink-2">
        Composants réels avec données locales. Aucun appel de modération à la
        production.
      </p>
      <ModerationProof />
    </main>
  );
}
