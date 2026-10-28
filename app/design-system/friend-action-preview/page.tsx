import type { Metadata } from "next";
import { FriendActionProof } from "@/components/friend-action-proof";

export const metadata: Metadata = {
  title: "FriendAction proof",
  robots: { index: false, follow: false }
};
export default function Page() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <p className="eyebrow">Test d’intégration</p>
      <h1 className="yk-title mt-3">États d’amitié partagés</h1>
      <p className="mt-4 text-sm text-ink-2">
        Le vrai composant FriendAction est monté dans ses deux contextes. Les
        clics sont déclenchés dans le navigateur avec un adaptateur sans RPC.
      </p>
      <div className="mt-8">
        <FriendActionProof />
      </div>
    </main>
  );
}
