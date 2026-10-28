"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Topbar,
  notificationItem,
  type NotificationItem
} from "@/components/topbar";
import { FriendsPanel, type FriendsPanelAdapter } from "@/components/friends";
import { Button } from "@/components/ui";
import type { TradesPanelAdapter } from "@/components/trades";
import type { TradeOffer } from "@/lib/data/trades";
import type { CollectedCard } from "@/lib/data/cards";
import {
  invalidateSocialUnread,
  type SocialUnreadAdapter
} from "@/lib/data/social-unread";
import {
  PrivateMessagesError,
  isPrivateMessageGif,
  type PrivateMessage,
  type PrivateMessagesAdapter
} from "@/lib/data/private-messages";

const players = [
  { id: "preview-bbdou", pseudo: "BBDOU", isOnline: true },
  { id: "preview-kitsune", pseudo: "Kitsune", isOnline: true },
  {
    id: "preview-yuki",
    pseudo: "Yuki",
    isOnline: false,
    lastSeenAt: new Date("2026-10-19T00:00:00Z").toISOString()
  }
];
const storageKey = "yokkai:private-messages-preview:v1";
const tradeStorageKey = "yokkai:conversation-trades-preview:v1";
const readStorageKey = "yokkai:message-reads-preview:v1";
const requestStorageKey = "yokkai:friend-request-preview:v1";
const sampleCard = (owner: string): CollectedCard => ({
  id: `sample-card-${owner}`,
  instanceId: `sample-copy-${owner}`,
  name: `Sample card · ${players.find(player => player.id === owner)?.pseudo ?? "Player"}`,
  category: "Anime/Manga",
  anime: "Local preview",
  rarity: "SSR",
  image: "/assets/premium-examples/gojo-original.png",
  catalogueImage: "/assets/premium-examples/gojo-original.png",
  customImageUrl: null,
  shiny: false,
  isEvolved: false,
  isFirstOwner: true,
  folderId: null,
  obtainedAt: "2026-10-19T00:00:00Z"
});
function readTrades(): TradeOffer[] {
  return JSON.parse(localStorage.getItem(tradeStorageKey) ?? "[]");
}
function previewOffer(
  from: string,
  to: string,
  offeredCards: CollectedCard[],
  requestedCards: CollectedCard[],
  offeredKaras: number,
  requestedKaras: number
): TradeOffer {
  return {
    id: crypto.randomUUID(),
    fromUser: from,
    toUser: to,
    fromPseudo: players.find(player => player.id === from)!.pseudo,
    toPseudo: players.find(player => player.id === to)!.pseudo,
    incoming: false,
    offeredCards,
    requestedCards,
    offeredKaras,
    requestedKaras,
    status: "pending",
    parentOfferId: null,
    createdAt: new Date().toISOString()
  };
}
const order = (a: PrivateMessage, b: PrivateMessage) =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
function readMessages(): PrivateMessage[] {
  try {
    const value = localStorage.getItem(storageKey);
    return value ? JSON.parse(value) : [];
  } catch {
    throw new Error(
      "Local storage is unavailable. Enable it to test messages."
    );
  }
}

export function PrivateMessagesPreview() {
  const [playerId, setPlayerId] = useState(players[0].id);
  const [failure, setFailure] = useState(false);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");
  const [initialConversationId, setInitialConversationId] = useState<string>();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const read = useRef(new Set<string>());
  const unread = useMemo<SocialUnreadAdapter>(
    () => ({
      load: async () => {
        const acknowledged: string[] = JSON.parse(
          localStorage.getItem(readStorageKey) ?? "[]"
        );
        const counts = new Map<string, number>();
        for (const message of readMessages()) {
          if (
            message.recipientId === playerId &&
            !acknowledged.includes(message.id)
          )
            counts.set(
              message.senderId,
              (counts.get(message.senderId) ?? 0) + 1
            );
        }
        const messages = [...counts].map(([friendId, count]) => ({
          friendId,
          count
        }));
        return {
          viewerId: playerId,
          messages,
          messageCount: messages.reduce((sum, item) => sum + item.count, 0),
          requestCount: Number(
            localStorage.getItem(`${requestStorageKey}:${playerId}`) ===
              "pending"
          )
        };
      }
    }),
    [playerId]
  );
  const refreshNotifications = useCallback(() => {
    try {
      const latest = new Map<string, PrivateMessage>();
      for (const message of readMessages()
        .filter(message => message.recipientId === playerId)
        .sort(order))
        latest.set(message.senderId, message);
      setNotifications(
        [...latest.values()].reverse().map(message =>
          notificationItem({
            id: message.id,
            type: "private_message_received",
            referenceId: message.senderId,
            readAt: read.current.has(message.id) ? message.createdAt : null,
            createdAt: message.createdAt,
            cardName: null,
            achievementName: null,
            actorPseudo:
              players.find(player => player.id === message.senderId)?.pseudo ??
              null
          })
        )
      );
    } catch {
      setError("Couldn't load local test notifications.");
    }
  }, [playerId]);
  useEffect(() => {
    refreshNotifications();
    const timer = window.setInterval(refreshNotifications, 1000);
    return () => window.clearInterval(timer);
  }, [refreshNotifications]);
  const messages = useMemo<PrivateMessagesAdapter>(
    () => ({
      list: async (friendId, cursor) => {
        const all = readMessages()
          .filter(
            message =>
              (message.senderId === playerId &&
                message.recipientId === friendId) ||
              (message.senderId === friendId &&
                message.recipientId === playerId)
          )
          .filter(
            message =>
              !cursor ||
              message.createdAt < cursor.at ||
              (message.createdAt === cursor.at && message.id < cursor.id)
          )
          .sort(order);
        const items = all.slice(-40);
        return {
          viewerId: playerId,
          readThroughId:
            items.filter(message => message.recipientId === playerId).at(-1)
              ?.id ?? null,
          items,
          next:
            all.length > 40 ? { at: items[0].createdAt, id: items[0].id } : null
        };
      },
      markRead: async (friendId, lastMessageId) => {
        const incoming = readMessages()
          .filter(
            message =>
              message.senderId === friendId && message.recipientId === playerId
          )
          .sort(order);
        const index = incoming.findIndex(
          message => message.id === lastMessageId
        );
        if (index < 0) throw new Error("This message is no longer available.");
        const previous: string[] = JSON.parse(
          localStorage.getItem(readStorageKey) ?? "[]"
        );
        localStorage.setItem(
          readStorageKey,
          JSON.stringify([
            ...new Set([
              ...previous,
              ...incoming.slice(0, index + 1).map(message => message.id)
            ])
          ])
        );
        invalidateSocialUnread();
      },
      send: async (friendId, text, id, gifUrl) => {
        await new Promise(resolve => window.setTimeout(resolve, 180));
        if (failure) {
          setFailure(false);
          throw new Error(
            "Couldn't send the message. Your draft has been kept."
          );
        }
        if (
          (!text.trim() && !gifUrl) ||
          Array.from(text.trim()).length > 2000 ||
          (gifUrl && !isPrivateMessageGif(gifUrl))
        )
          throw new PrivateMessagesError(
            "Write a message between 1 and 2,000 characters."
          );
        const all = readMessages();
        const existing = all.find(message => message.id === id);
        if (existing) return existing;
        const message = {
          id,
          senderId: playerId,
          recipientId: friendId,
          text: text.trim(),
          gifUrl: gifUrl ?? null,
          createdAt: new Date().toISOString()
        };
        localStorage.setItem(storageKey, JSON.stringify([...all, message]));
        invalidateSocialUnread();
        return message;
      }
    }),
    [playerId, failure]
  );
  const trades = useMemo<TradesPanelAdapter>(
    () => ({
      friendships: async () => ({
        friends: players.filter(player => player.id !== playerId),
        incoming: [],
        outgoing: []
      }),
      listOffers: async () =>
        readTrades()
          .filter(
            offer => offer.fromUser === playerId || offer.toUser === playerId
          )
          .map(offer => ({ ...offer, incoming: offer.toUser === playerId })),
      context: async friendId => ({
        friend: players.find(player => player.id === friendId)!,
        balance: 4499,
        ownCards: [sampleCard(playerId)],
        friendCards: [sampleCard(friendId)]
      }),
      create: async input => {
        if (
          !players.some(player => player.id === input.toUser) ||
          input.toUser === playerId
        )
          throw Error("Choose a friend.");
        const offer = previewOffer(
          playerId,
          input.toUser,
          input.offeredCardIds.length ? [sampleCard(playerId)] : [],
          input.requestedCardIds.length ? [sampleCard(input.toUser)] : [],
          input.offeredKaras,
          input.requestedKaras
        );
        localStorage.setItem(
          tradeStorageKey,
          JSON.stringify([...readTrades(), offer])
        );
        return offer.id;
      },
      cancel: async id => {
        localStorage.setItem(
          tradeStorageKey,
          JSON.stringify(
            readTrades().map(offer =>
              offer.id === id &&
              offer.fromUser === playerId &&
              offer.status === "pending"
                ? { ...offer, status: "cancelled" }
                : offer
            )
          )
        );
        return true;
      },
      respond: async (id, action) => {
        await new Promise(resolve => window.setTimeout(resolve, 180));
        const offers = readTrades();
        const offer = offers.find(item => item.id === id);
        if (!offer || offer.toUser !== playerId || offer.status !== "pending")
          throw Error("This offer is no longer pending.");
        localStorage.setItem(
          tradeStorageKey,
          JSON.stringify(
            offers.map(item =>
              item.id === id
                ? {
                    ...item,
                    status: action === "accept" ? "accepted" : "declined"
                  }
                : item
            )
          )
        );
        return true;
      }
    }),
    [playerId]
  );
  const adapter = useMemo<FriendsPanelAdapter>(
    () => ({
      friendships: async () => ({
        friends: players.filter(player => player.id !== playerId),
        incoming:
          localStorage.getItem(`${requestStorageKey}:${playerId}`) === "pending"
            ? [
                {
                  id: "preview-inviter",
                  pseudo: "New collector",
                  requestId: "preview-request"
                }
              ]
            : [],
        outgoing: []
      }),
      search: async query =>
        players
          .filter(
            player =>
              player.id !== playerId &&
              player.pseudo.toLowerCase().includes(query.toLowerCase())
          )
          .map(player => ({ ...player, status: "accepted" as const })),
      respond: async () => {
        localStorage.removeItem(`${requestStorageKey}:${playerId}`);
        invalidateSocialUnread();
      },
      remove: async () => undefined,
      moderation: {
        list: async () => [],
        block: async () => undefined,
        unblock: async () => undefined,
        report: async () => undefined
      },
      messages,
      unread,
      trades
    }),
    [playerId, messages, trades, unread]
  );

  function seed() {
    const friendId = players.find(player => player.id !== playerId)!.id;
    const now = Date.now();
    const seeded = Array.from({ length: 55 }, (_, index) => ({
      id: crypto.randomUUID(),
      senderId: index % 2 ? playerId : friendId,
      recipientId: index % 2 ? friendId : playerId,
      text:
        index % 2
          ? `Sounds good! Message ${index + 1}.`
          : `Want to trade a card later? Message ${index + 1}.`,
      createdAt: new Date(now - (55 - index) * 60_000).toISOString()
    }));
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify([...readMessages(), ...seeded])
      );
      setVersion(value => value + 1);
      invalidateSocialUnread();
      setError("");
    } catch {
      setError("Couldn't save the local test messages.");
    }
  }
  return (
    <>
      <Topbar
        view="friends"
        name={players.find(player => player.id === playerId)?.pseudo}
        karas={4499}
        notifications={notifications}
        socialUnread={unread}
        onRefreshNotifications={refreshNotifications}
        onReadAll={() => {
          for (const item of notifications) read.current.add(item.id);
          refreshNotifications();
        }}
        onOpenNotification={async (id, href) => {
          read.current.add(id);
          refreshNotifications();
          setInitialConversationId(
            new URL(href, window.location.origin).searchParams.get("message") ??
              undefined
          );
        }}
      />
      <main className="mx-auto w-full max-w-6xl px-6 py-10">
        <p className="eyebrow">Between collectors</p>
        <h1 className="yk-title mt-3">My friends</h1>
        <div className="mt-8">
          <div className="yk-private-messages-preview-tools">
            <label>
              View as{" "}
              <select
                className="auth-input"
                aria-label="Preview player"
                value={playerId}
                onChange={event => {
                  setInitialConversationId(undefined);
                  setPlayerId(event.target.value);
                }}
              >
                {players.map(player => (
                  <option key={player.id} value={player.id}>
                    {player.pseudo}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="secondary" onClick={seed}>
              Add sample conversation
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                localStorage.setItem(
                  `${requestStorageKey}:${playerId}`,
                  "pending"
                );
                invalidateSocialUnread();
                setVersion(value => value + 1);
              }}
            >
              Add sample friend request
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                try {
                  const friendId = players.find(
                    player => player.id !== playerId
                  )!.id;
                  const incoming = previewOffer(
                    friendId,
                    playerId,
                    [sampleCard(friendId)],
                    [sampleCard(playerId)],
                    125,
                    50
                  );
                  const outgoing = previewOffer(
                    playerId,
                    friendId,
                    [sampleCard(playerId)],
                    [],
                    0,
                    75
                  );
                  localStorage.setItem(
                    tradeStorageKey,
                    JSON.stringify([...readTrades(), incoming, outgoing])
                  );
                  setVersion(value => value + 1);
                  setError("");
                } catch {
                  setError("Couldn't save local test trades.");
                }
              }}
            >
              Add sample trades
            </Button>
            <label>
              <input
                type="checkbox"
                checked={failure}
                onChange={event => setFailure(event.target.checked)}
              />{" "}
              Fail the next send
            </label>
            <p>
              Local preview only. Choose a player, click Message, then switch
              players to reply. Two tabs share this test history. No real
              players are contacted.
            </p>
            {error && <p role="alert">{error}</p>}
          </div>
          <FriendsPanel
            key={`${playerId}:${version}`}
            adapter={adapter}
            initialConversationId={initialConversationId}
            onConversationClose={() => setInitialConversationId(undefined)}
          />
        </div>
      </main>
    </>
  );
}
