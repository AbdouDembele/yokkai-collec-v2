import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CardCinematic } from "@/components/card-cinematic";
import { createLocalLrPack } from "@/lib/ui/local-lr-packs";

export const metadata: Metadata = {
  title: "Local LR cinematic",
  robots: { index: false, follow: false }
};

export default function LrCinematicPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <main className="yk-lr-demo">
      <header>
        <div>
          <h1>Legendary cinematic</h1>
          <p>Local preview only. No packs consumed, no collection changes.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/design-system/card-cinematics"
            className="yk-button yk-button-primary"
          >
            New SSR &amp; LR cinematics
          </Link>
          <Link
            href="/design-system/lr-packs"
            className="yk-button yk-button-primary"
          >
            Test packs with a final LR
          </Link>
          <Link href="/boosters" className="yk-button yk-button-secondary">
            Back to packs
          </Link>
        </div>
      </header>
      <div className="yk-card-cinematic-demo">
        <CardCinematic card={createLocalLrPack("regular", 0)[4]} />
      </div>
    </main>
  );
}
