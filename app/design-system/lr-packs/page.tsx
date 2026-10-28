import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalLrPacksPreview } from "@/components/local-lr-packs-preview";

export const metadata: Metadata = {
  title: "Local LR test packs",
  robots: { index: false, follow: false }
};

export default function LocalLrPacksPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <main className="yk-game-main mx-auto w-full max-w-6xl px-6 py-8">
      <header className="yk-pack-page-heading mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="eyebrow">Local preview only</p>
          <h1 className="yk-title mt-2">LR test packs</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-2">
            Open a pack and reveal all five cards. Madara, Omni-Man and Shadow
            take turns in the final LR slot. Nothing is added to your
            collection.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/design-system/card-cinematics"
            className="yk-button yk-button-secondary"
          >
            SSR &amp; LR cinematics
          </Link>
          <Link href="/boosters" className="yk-button yk-button-secondary">
            Back to packs
          </Link>
        </div>
      </header>
      <LocalLrPacksPreview />
    </main>
  );
}
