"use client";

import { useEffect, useRef, useState } from "react";
import {
  AchievementCard,
  AchievementsGallery
} from "@/components/achievements";
import { WishlistView } from "@/components/community-views";
import { notificationItem, Topbar } from "@/components/topbar";
import type { Achievement } from "@/lib/data/achievements";
import type { WishlistCard } from "@/lib/data/wishlist";
import type { AppNotification } from "@/lib/data/notifications";

const now = new Date().toISOString();
const achievements: Achievement[] = [
  {
    id: "packs",
    title: "Ouvreur frénétique",
    description: "Ouvrir 10 boosters réguliers",
    conditionType: "regular_packs_opened",
    conditionValue: 10,
    conditionCategory: null,
    karasReward: 250,
    progressCurrent: 7,
    progressTarget: 10,
    progressLabel: null,
    completedAt: null,
    claimedAt: null
  },
  {
    id: "market",
    title: "Premier pas dans le marché",
    description: "Remporter votre première enchère",
    conditionType: "auctions_won",
    conditionValue: 1,
    conditionCategory: null,
    karasReward: 100,
    progressCurrent: 1,
    progressTarget: 1,
    progressLabel: null,
    completedAt: now,
    claimedAt: null
  },
  {
    id: "legend",
    title: "Légende du Tantō",
    description: "Obtenir votre première carte LR",
    conditionType: "first_lr_card",
    conditionValue: 1,
    conditionCategory: null,
    karasReward: 1000,
    progressCurrent: 1,
    progressTarget: 1,
    progressLabel: null,
    completedAt: now,
    claimedAt: now
  },
  {
    id: "trades",
    title: "Échangeur équitable",
    description: "Conclure 5 échanges entre amis",
    conditionType: "trades_completed",
    conditionValue: 5,
    conditionCategory: null,
    karasReward: 300,
    progressCurrent: 2,
    progressTarget: 5,
    progressLabel: null,
    completedAt: null,
    claimedAt: null
  }
];
const wishlistCards: WishlistCard[] = ["LR", "SSR", "SR", "R", "C"].map(
  (rarity, index) => ({
    id: `wish-${index}`,
    name: [
      "Kuro Kitsune",
      "Aoi Dragon",
      "Ken Flame",
      "Yuki Frost",
      "Ren Cyber"
    ][index],
    category: "Anime",
    anime: [
      "Spirit Realm",
      "Neo Tokyo",
      "Kendo Academy",
      "Winter Saga",
      "Neo Tokyo"
    ][index],
    rarity: rarity as WishlistCard["rarity"],
    image: "/assets/booster-pack.png",
    createdAt: now
  })
);
const rawNotifications: AppNotification[] = [
  {
    id: "n1",
    type: "wishlist_card_on_auction",
    referenceId: "auction-wishlist",
    readAt: null,
    createdAt: now,
    cardName: "Kuro Kitsune",
    actorPseudo: null,
    achievementName: null
  },
  {
    id: "n2",
    type: "outbid",
    referenceId: "auction-outbid",
    readAt: null,
    createdAt: now,
    cardName: "Aoi Dragon",
    actorPseudo: null,
    achievementName: null
  },
  {
    id: "n3",
    type: "auction_won",
    referenceId: "auction-won",
    readAt: null,
    createdAt: now,
    cardName: "Ren Cyber",
    actorPseudo: null,
    achievementName: null
  },
  {
    id: "n4",
    type: "friend_request",
    referenceId: "friend-request",
    readAt: now,
    createdAt: now,
    cardName: null,
    actorPseudo: "CyberSamurai",
    achievementName: null
  },
  {
    id: "n5",
    type: "trade_offer_received",
    referenceId: "trade-offer",
    readAt: now,
    createdAt: now,
    cardName: null,
    actorPseudo: "KpopFan99",
    achievementName: null
  },
  {
    id: "n6",
    type: "achievement_completed",
    referenceId: "market",
    readAt: now,
    createdAt: now,
    cardName: null,
    actorPseudo: null,
    achievementName: "Premier pas dans le marché"
  }
];
const notifications = rawNotifications.map(notificationItem);

export function AchievementsPreview() {
  const [items, setItems] = useState(achievements);
  return (
    <AchievementsGallery
      items={items}
      onClaim={async item =>
        setItems(current =>
          current.map(entry =>
            entry.id === item.id ? { ...entry, claimedAt: now } : entry
          )
        )
      }
    />
  );
}
export function WishlistPreview({ empty = false }: { empty?: boolean }) {
  return (
    <WishlistView
      previewCards={empty ? [] : wishlistCards}
      onRemove={async () => {}}
    />
  );
}
export function NotificationsPreview({
  mode = "list"
}: {
  mode?: "list" | "empty" | "error";
}) {
  useEffect(() => {
    const frame = window.requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-controls="notifications-panel"]'
        )
        ?.click()
    );
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return (
    <>
      <Topbar
        view="wishlist"
        name="Kitsune"
        karas={4920}
        notifications={mode === "empty" ? [] : notifications}
        notificationError={
          mode === "error"
            ? "Impossible de charger tes notifications"
            : undefined
        }
        onRetryNotifications={() => {}}
        onReadAll={() => {}}
        onOpenNotification={async () => {}}
      />
      <div className="min-h-96" />
    </>
  );
}

export function PhaseEightActionProof() {
  const [events, setEvents] = useState<string[]>([]);
  const started = useRef(false);
  const [claimItem, setClaimItem] = useState(achievements[1]);
  const record = (event: string) =>
    setEvents(current =>
      current.includes(event) ? current : [...current, event]
    );
  const expected = [
    "claimAchievement:market",
    "toggleWishlist:wish-0",
    ...notifications.map(item => `notification:${item.id}:${item.href}`)
  ];
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const run = async () => {
      await new Promise(resolve => window.setTimeout(resolve, 100));
      document
        .querySelector<HTMLButtonElement>("[data-proof-claim] button")
        ?.click();
      document
        .querySelector<HTMLButtonElement>(
          "[data-proof-wishlist] .yk-wishlist-item button"
        )
        ?.click();
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-controls="notifications-panel"]'
        )
        ?.click();
      await new Promise(resolve => window.setTimeout(resolve, 100));
      document
        .querySelectorAll<HTMLAnchorElement>(
          "#notifications-panel .yk-notification-list a"
        )
        .forEach(link => link.click());
    };
    void run();
  }, []);
  const passed = expected.every(event => events.includes(event));
  return (
    <div className="yk-social-stack">
      <div
        className={`yk-feedback ${passed ? "yk-feedback-success" : ""}`}
        data-proof-result={passed ? "passed" : "running"}
      >
        <strong>
          {passed ? "Preuve d’intégration réussie" : "Test des clics en cours…"}
        </strong>
        <span>
          {events.length}/{expected.length} appels vérifiés
        </span>
      </div>
      <section className="yk-social-panel" data-proof-claim>
        <h2 className="yk-section-title">Réclamation</h2>
        <div className="mt-5">
          <AchievementCard
            item={claimItem}
            onClaim={async item => {
              record(`claimAchievement:${item.id}`);
              setClaimItem({ ...item, claimedAt: now });
            }}
          />
        </div>
      </section>
      <section className="yk-social-panel" data-proof-wishlist>
        <h2 className="yk-section-title">Retrait Wishlist</h2>
        <WishlistView
          previewCards={[wishlistCards[0]]}
          onRemove={async id => record(`toggleWishlist:${id}`)}
        />
      </section>
      <Topbar
        view="wishlist"
        name="Kitsune"
        karas={4920}
        notifications={notifications}
        onReadAll={() => {}}
        onOpenNotification={async (id, href) =>
          record(`notification:${id}:${href}`)
        }
      />
      <pre id="phase-eight-proof-log">{events.join("\n")}</pre>
    </div>
  );
}
