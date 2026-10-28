import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CardCinematicsPreview } from "@/components/card-cinematics-preview";

export const metadata: Metadata = {
  title: "SSR & LR cinematics",
  robots: { index: false, follow: false }
};

export default function CardCinematicsPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <main className="yk-lr-demo">
      <header>
        <div>
          <h1>SSR &amp; LR cinematics</h1>
          <p>Local preview only. No packs consumed, no collection changes.</p>
        </div>
        <Link
          href="/design-system/lr-packs"
          className="yk-button yk-button-primary"
        >
          Test full packs
        </Link>
      </header>
      <CardCinematicsPreview />
    </main>
  );
}
