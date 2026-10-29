"use client";
import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  AuctionView,
  type AuctionChatAdapter,
  type AuctionPresentation
} from "@/components/community-views";
import { MessengerSession } from "@/components/floating-messenger";
import { SiteFooter } from "@/components/site-footer";
import type { SocialUnread } from "@/lib/data/social-unread";
const unread: SocialUnread = {
  viewerId: "layout-preview",
  messages: [],
  messageCount: 0,
  requestCount: 0
};
const loadConversations = async () => ({
  viewerId: "layout-preview",
  items: [],
  next: null
});
const chatAdapter: AuctionChatAdapter = {
  get: async () => ({ canPost: false, participants: [], messages: [] }),
  send: async () => {
    throw new Error("Read-only layout fixture");
  }
};
export function FloatingLayoutPreview() {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const [count, setCount] = useState(100),
    [expandedFooter, setExpandedFooter] = useState(false);
  const auction: AuctionPresentation = {
    id: "layout-preview",
    card: {
      id: "layout-card",
      name: "Layout preview",
      anime: "Preview",
      category: "ANIME/MANGA",
      rarity: "SR",
      image: "/assets/premium-examples/gojo-original.png"
    },
    amount: 1000,
    remaining: "01:00:00",
    remainingSeconds: 3600,
    seller: "Preview seller",
    bids: count,
    balance: 5000,
    nextBid: 1010,
    minimumBid: 1010,
    history: Array.from({ length: count }, (_, i) => ({
      id: String(i),
      name:
        i % 3 === 0
          ? "A-player-with-a-long-display-name"
          : "Player " + String(i + 1),
      time: "12:00",
      amount: 1000 - i,
      mine: i === 1
    }))
  };
  return (
    <>
      <main id="main-content" className="yk-game-main">
        <div className="mx-auto w-full max-w-[var(--layout-collection-max)] px-4 py-8">
          <div className="flex flex-wrap gap-3" data-layout-controls>
            <button className="yk-button" onClick={() => setCount(5)}>
              Five bids
            </button>
            <button className="yk-button" onClick={() => setCount(100)}>
              One hundred bids
            </button>
            <button
              className="yk-button"
              onClick={() => setExpandedFooter(v => !v)}
            >
              Resize footer
            </button>
          </div>
          <AuctionView auction={auction} chatAdapter={chatAdapter} />
        </div>
      </main>
      <SiteFooter
        discordEnabled={false}
        note={
          expandedFooter
            ? "A longer footer note for testing responsive wrapping and live footer resizing. ".repeat(
                7
              )
            : undefined
        }
      />
      {mounted &&
        createPortal(
          <MessengerSession
            unread={unread}
            loadConversations={loadConversations}
          />,
          document.body
        )}
    </>
  );
}
