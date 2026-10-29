"use client";
import { useMemo, useRef } from "react";
import {
  AuctionChatPanel,
  type AuctionChatAdapter
} from "@/components/community-views";
import { DmComposerPreview } from "@/components/dm-composer-preview";
import { ProfileExperience } from "@/components/profile";
import type { PrivateMessage } from "@/lib/data/private-messages";
import type { Profile } from "@/lib/data/profile";
import type { CollectedCard } from "@/lib/data/cards";
import type { PlayerCosmetics } from "@/components/styled-player-name";
import "@/styles/market.css";
const style: PlayerCosmetics = {
  active: true,
  style: { avatarFrame: "bloodmoon" }
};
const players = [
  {
    userId: "preview-alice",
    pseudo: "Alice",
    avatarUrl: "/assets/landing/levi.webp",
    mine: false,
    profileStyle: style
  },
  {
    userId: "preview-private",
    pseudo: "Private Player",
    mine: false,
    profileStyle: {
      active: true,
      style: { avatarFrame: "bloom" }
    } as PlayerCosmetics
  },
  { userId: "preview-error", pseudo: "Retry Player", mine: false }
];
const cards: Array<CollectedCard> = Array.from({ length: 25 }, (_, i) => ({
  id: "card-" + i,
  instanceId: "instance-" + i,
  name: ["Satoru Gojo", "Levi", "Luffy"][i % 3],
  rarity: "LR",
  category: "ANIME/MANGA",
  anime: "Preview",
  image: [
    "/assets/landing/gojou.webp",
    "/assets/landing/levi.webp",
    "/assets/landing/luffy.webp"
  ][i % 3],
  obtainedAt: "2026-10-29T10:00:00Z",
  shiny: false,
  isEvolved: false,
  isFirstOwner: true,
  folderId: null,
  catalogueImage: "",
  customImageUrl: null
}));
export function ChatProfilePreview({
  friend = false,
  fullProfile = false,
  blocked = false
}: {
  friend?: boolean;
  fullProfile?: boolean;
  blocked?: boolean;
}) {
  const dmMessages = useRef<PrivateMessage[]>([
    {
      id: "preview-profile-dm",
      senderId: "preview-alice",
      recipientId: "preview-viewer",
      text: "Preview conversation",
      createdAt: "2026-10-29T12:00:00Z"
    }
  ]);
  const failed = useRef(0);
  const adapter = useMemo<AuctionChatAdapter>(
    () => ({
      get: async () => ({
        canPost: true,
        participants: players,
        messages: [
          {
            id: "first",
            ...players[0],
            message:
              "Salut @Alice ! @Private Player, regarde cette carte. @Unknown reste du texte, mail@Alice.fr aussi.",
            createdAt: "2026-10-29T10:00:00Z"
          },
          {
            id: "second",
            ...players[1],
            message: "Merci @Alice. Test @Retry Player.",
            createdAt: "2026-10-29T10:01:00Z"
          }
        ]
      }),
      send: async () => {
        throw Error("Read-only preview");
      },
      preview: {
        messages: {
          list: async () => ({
            viewerId: "preview-viewer",
            items: [...dmMessages.current],
            next: null
          }),
          markRead: async () => {},
          send: async (id, text, messageId, gifUrl) => {
            const message = {
              id: messageId,
              senderId: "preview-viewer",
              recipientId: id,
              text,
              gifUrl,
              createdAt: new Date().toISOString()
            };
            dmMessages.current.push(message);
            return message;
          }
        },
        trades: {
          friendships: async () => ({
            friends: [],
            incoming: [],
            outgoing: []
          }),
          listOffers: async () => [],
          context: async () => ({
            friend: { id: "preview-alice", pseudo: "Alice" },
            balance: 0,
            ownCards: [],
            friendCards: []
          }),
          create: async () => "preview",
          cancel: async () => true,
          respond: async () => true
        },
        profile: async id => {
          await new Promise(r => setTimeout(r, 150));
          if (id === "preview-error" && failed.current < 2) {
            failed.current += 1;
            throw Error("Fixture failure");
          }
          const p = players.find(p => p.userId === id)!;
          return {
            id,
            pseudo: p.pseudo,
            avatarUrl: p.avatarUrl ?? null,
            profileStyle: p.profileStyle,
            bio: "",
            bannerCard: null,
            friendshipStatus:
              friend && id === "preview-alice" ? "accepted" : "none",
            isPublic: id !== "preview-private",
            canViewCollection: id !== "preview-private",
            featuredCards: cards.slice(0, 3),
            friends: [],
            friendsVisible: false,
            cardCount: 25,
            distinctCardCount: 25
          } as Profile;
        },
        friendCollection: async id => {
          if (id === "preview-private")
            throw Error("Private collection must not load");
          await new Promise(r => setTimeout(r, 100));
          return cards;
        },
        wishlist: async () => [],
        blocked: async () =>
          blocked ? [{ id: "preview-alice", pseudo: "Alice" }] : [],
        friendAction: { send: async () => true, respond: async () => true },
        moderation: {
          block: async () => {},
          unblock: async () => {},
          report: async () => {},
          list: async () => []
        },
        details: async () => ({
          joinedAt: "2026-10-14T12:00:00Z",
          interests: { anime: [], games: [], kpop: [], other: [] },
          widgets: [],
          widgetCategories: [],
          bannerUrl: null,
          boostersOpened: 255,
          lrCount: 5,
          ssrCount: 6,
          mutualFriends: [],
          favoriteAlbums: [
            { license: "Jujutsu Kaisen", total: 20, owned: 12, percent: 60 },
            { license: "Attack on Titan", total: 15, owned: 15, percent: 100 },
            { license: "One Piece", total: 30, owned: 9, percent: 30 }
          ],
          activity: []
        }),
        engagement: async () => ({ likes: 7, likedByMe: false }),
        like: async (_id, liked) => ({ likes: liked ? 8 : 7, likedByMe: liked })
      }
    }),
    [friend, blocked]
  );
  return (
    <main
      style={{
        maxWidth: fullProfile ? 1200 : 550,
        margin: "24px auto",
        padding: 16
      }}
    >
      {fullProfile ? (
        <ProfileExperience
          identifier="preview-alice"
          adapter={adapter.preview}
        />
      ) : (
        <AuctionChatPanel
          auctionId="preview"
          refreshKey={0}
          finished={false}
          adapter={adapter}
        />
      )}
      <DmComposerPreview />
    </main>
  );
}
