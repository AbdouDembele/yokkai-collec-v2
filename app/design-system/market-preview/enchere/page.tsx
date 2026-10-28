import type { Metadata } from "next";
import Link from "next/link";
import { AuctionPreview } from "@/components/market-preview";
import { Topbar } from "@/components/topbar";

export const metadata: Metadata = {
  title: "Enchère preview",
  robots: { index: false, follow: false }
};
const scenarios = ["live", "poor", "won", "lost"] as const;

export default async function AuctionPreviewPage({
  searchParams
}: {
  searchParams: Promise<{ scenario?: string }>;
}) {
  const { scenario: requested } = await searchParams;
  const scenario = scenarios.find(item => item === requested) ?? "live";
  return (
    <>
      <Topbar view="market" name="Kitsune" karas={4920} notifications={[]} />
      <main className="mx-auto w-full max-w-6xl px-6 py-10">
        <Link href="/design-system/market-preview" className="yk-back-link">
          ← Retour au marché
        </Link>
        <p className="eyebrow">Marché · Enchère</p>
        <h1 className="yk-title mt-3">Détail de l’enchère</h1>
        <AuctionPreview key={scenario} scenario={scenario} />
      </main>
    </>
  );
}
