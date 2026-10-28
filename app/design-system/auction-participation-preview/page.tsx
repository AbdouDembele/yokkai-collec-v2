import type { Metadata } from "next";
import { AuctionParticipationProof } from "@/components/auction-participation-proof";

export const metadata: Metadata = {
  title: "Auction participation proof",
  robots: { index: false, follow: false }
};
export default async function Page({
  searchParams
}: {
  searchParams: Promise<{ disabled?: string }>;
}) {
  const disabled = (await searchParams).disabled === "1";
  return (
    <main className="mx-auto w-full max-w-[var(--layout-collection-max)] px-6 py-10">
      <p className="eyebrow">Test d’intégration</p>
      <h1 className="yk-title mt-3">Participation aux enchères</h1>
      <p className="mt-4 text-sm text-ink-2">
        La vraie vue Marché reçoit le signal calculé par la RPC. La variante{" "}
        <code>?disabled=1</code> retire uniquement ce signal pour la
        contre-preuve.
      </p>
      <div className="mt-8">
        <AuctionParticipationProof disabled={disabled} />
      </div>
    </main>
  );
}
