import { cardRarityLabel } from "@/lib/ui/card-rarity-label";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CardShell } from "@/components/card-shell";
import { SiteFooter } from "@/components/site-footer";
import { YokaiCard } from "@/components/yokai-card";
import { getDiscordInviteUrl } from "@/lib/discord-invite";
import { getSharedCard, isShareImageUrl } from "@/lib/server/card-sharing";
import type { Rarity } from "@/lib/data/cards";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };
const rarityText: Record<Rarity, string> = {
  C: "text-rarity-c",
  R: "text-rarity-r",
  SR: "text-rarity-sr",
  SSR: "text-rarity-ssr",
  LR: "text-rarity-lr"
};

function siteOrigin() {
  const fallback =
    process.env.NODE_ENV === "production" ? undefined : "http://localhost:3000";
  const value = process.env.NEXT_PUBLIC_SITE_URL || fallback;
  if (!value) throw new Error("NEXT_PUBLIC_SITE_URL is required");
  return new URL(value).origin;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const card = await getSharedCard(id);
  if (!card) notFound();
  const owner = card.pseudo ? ` by ${card.pseudo}` : "";
  const description = `${card.cardName}, a ${cardRarityLabel(card.rarity, card.shiny, card.isEvolved)} card${card.franchise ? ` from ${card.franchise}` : ""}, shared${owner} on Yokkai Collec'.`;
  const url = `${siteOrigin()}/share/${id}`;
  const image = `${url}/image/og`;
  return {
    title: card.cardName,
    description,
    robots: { index: false, follow: false },
    alternates: { canonical: url },
    openGraph: {
      url,
      locale: "en_US",
      title: `${card.cardName} · Yokkai Collec'`,
      description,
      images: [{ url: image, width: 1200, height: 630, alt: card.cardName }]
    },
    twitter: {
      card: "summary_large_image",
      title: `${card.cardName} · Yokkai Collec'`,
      description,
      images: [image]
    }
  };
}

export default async function SharedCardPage({ params }: Props) {
  const { id } = await params;
  const card = await getSharedCard(id);
  if (!card) notFound();
  const label = cardRarityLabel(card.rarity, card.shiny, card.isEvolved);
  return (
    <div className="yk-info-page" data-tone="navy">
      <header className="yk-info-header">
        <Link
          href="/"
          className="yk-info-brand"
          aria-label="Yokkai Collec', home"
        >
          <Image
            src="/assets/brand-logo-ice-retro.png"
            alt=""
            width={1672}
            height={941}
            priority
          />
        </Link>
        <Link href="/login" className="yk-info-play-link">
          Sign in
        </Link>
      </header>
      <main id="main-content" className="yk-share-main">
        <div className="yk-share-card">
          <CardShell>
            <YokaiCard
              rarity={card.rarity}
              shiny={card.shiny}
              isEvolved={card.isEvolved}
              name={card.cardName}
              category={card.category ?? ""}
              anime={card.franchise ?? undefined}
              image={
                isShareImageUrl(card.catalogueImageUrl)
                  ? card.catalogueImageUrl
                  : undefined
              }
            />
          </CardShell>
        </div>
        <div className="yk-share-copy">
          <p className="eyebrow">Shared card</p>
          <h1>{card.cardName}</h1>
          <p className="yk-share-meta">
            <span className={rarityText[card.rarity]}>{label}</span>
            {card.franchise && <span>{card.franchise}</span>}
          </p>
          {card.pseudo && (
            <p className="yk-share-owner">
              Shared by <strong>{card.pseudo}</strong>
            </p>
          )}
          <p className="yk-share-pitch">
            Open packs, collect characters from your favorite series and trade
            with friends.
          </p>
          <div className="yk-share-actions">
            <Link className="yk-button yk-button-primary" href="/signup">
              Join Yokkai Collec&apos;
            </Link>
            <Link className="yk-button yk-button-secondary" href="/login">
              Sign in
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter discordEnabled={Boolean(getDiscordInviteUrl())} />
    </div>
  );
}
