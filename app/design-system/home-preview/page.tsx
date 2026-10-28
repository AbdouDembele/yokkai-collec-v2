import { useTranslations } from "next-intl";
import { AmbientGlow } from "@/components/ambient-glow";
import type { Metadata } from "next";
import { Topbar } from "@/components/topbar";
import { SiteFooter } from "@/components/site-footer";
import { HomePanel } from "@/components/home-dashboard";
import { HomeFriendFeedPreview } from "@/components/home-friend-feed-preview";
import { HomeHero, HomeLinks, HomePacks } from "@/components/home-content";
import {
  HomePackTimer,
  LatestPulls,
  BigPulls,
  HomeMarket
} from "@/components/home-live";
import { AUTH_MARQUEE_CARDS } from "@/lib/auth/showcase-cards";
import type { HomeCard, BigPull } from "@/lib/data/home";
import type { AuctionData } from "@/lib/data/market";

export const metadata: Metadata = {
  title: "Home preview",
  robots: { index: false, follow: false }
};

const now = Date.now();

export default function HomePreview() {
  const t = useTranslations("homeDashboard");
  const cards: HomeCard[] = Array.from({ length: 12 }, (_, index) => ({
    ...AUTH_MARQUEE_CARDS[index % AUTH_MARQUEE_CARDS.length],
    instanceId: `preview-${index}`,
    obtainedAt: new Date(now - index * 120000).toISOString(),
    shiny: index === 1
  }));
  const pulls: BigPull[] = cards.map((card, index) => ({
    instanceId: card.instanceId,
    obtainedAt: card.obtainedAt,
    card,
    playerId: index === 2 ? null : `preview-player-${index % 3}`,
    avatarUrl: index === 2 ? null : AUTH_MARQUEE_CARDS[index % 3].image,
    playerName:
      index === 2 ? null : ["Kitsune", "Moonflower", "Raven"][index % 3]
  }));
  const auctions: AuctionData[] = cards.slice(0, 6).map((card, index) => ({
    id: `preview-${index}`,
    card,
    amount: 240 + index * 380,
    endsAt: new Date(now + 1800000 + index * 600000).toISOString(),
    status: "active",
    seller: "Kitsune",
    sellerId: null,
    bids: index + 1,
    watched: false
  }));
  return (
    <div className="relative isolate flex min-h-dvh w-full flex-col">
      <AmbientGlow variant="home" />
      <Topbar
        view="home"
        name="Kitsune"
        karas={4920}
        notifications={[
          {
            id: "79020000-0000-4000-9000-000000000001",
            title: t("previewReplyTitle"),
            text: t("previewReply", { player: "Moonflower" }),
            time: new Date(now).toLocaleString("en-US"),
            read: false,
            href: "/profile?tab=wall",
            kind: "reply"
          }
        ]}
      />
      <main id="main-content" className="yk-home-main">
        <HomeHero />
        <HomePacks>
          <HomePackTimer
            initial={{
              available: 3,
              maximum: 3,
              nextPackAt: null,
              serverNow: now
            }}
            preview
          />

          <HomePackTimer
            kind="decision"
            initial={{
              available: 1,
              maximum: 1,
              nextPackAt: now + 3600000,
              serverNow: now
            }}
            preview
          />
        </HomePacks>
        <HomePanel
          id="home-latest"
          title={t("yourLatestPulls")}
          href="/collection"
          link={t("viewCollection")}
        >
          <LatestPulls cards={cards} />
        </HomePanel>
        <HomePanel id="home-big" title={t("previewBigPulls")}>
          <BigPulls pulls={pulls} />
        </HomePanel>
        <HomePanel
          id="home-market"
          title={t("theMarket")}
          href="/market"
          link={t("previewBrowseMarket")}
        >
          <HomeMarket initial={auctions} preview />
        </HomePanel>
        <HomeFriendFeedPreview />
        <HomeLinks discordEnabled />
      </main>
      <SiteFooter discordEnabled />
    </div>
  );
}
