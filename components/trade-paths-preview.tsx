"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Button } from "@/components/ui";
import { FriendsPanel, type FriendsPanelAdapter } from "@/components/friends";
import { TradesPanel, type TradesPanelAdapter } from "@/components/trades";
import type { TradeOffer } from "@/lib/data/trades";
const friend = "f9100000-0000-4000-8000-000000000001",
  viewer = "f9100000-0000-4000-8000-000000000002";
// Isolated browser fixture: no authenticated RPC, player mutation or real trade.
export function TradePathsPreview({
  entry = "notification",
  slow = false,
  failRefresh = false,
  reject = false
}: {
  entry?: string;
  slow?: boolean;
  failRefresh?: boolean;
  reject?: boolean;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const [open, setOpen] = useState(false),
    [events, setEvents] = useState<string[]>([]),
    [route, setRoute] = useState<{ active: boolean; friendId?: string }>({
      active: false
    });
  const status = useRef<TradeOffer["status"]>("pending"),
    created = useRef<TradeOffer | undefined>(undefined),
    mutated = useRef(false);
  const adapter = useMemo<TradesPanelAdapter>(
    () => ({
      friendships: async () => {
        setEvents(e => [...e, "friends"]);
        if (slow) await new Promise(r => setTimeout(r, 5000));
        return {
          friends: [{ id: friend, pseudo: "Trade Friend" }],
          incoming: [],
          outgoing: []
        };
      },
      listOffers: async () => {
        setEvents(e => [...e, "offers"]);
        if (failRefresh && mutated.current)
          throw Error("Test refresh unavailable");
        const offer: TradeOffer = {
          id: "preview-offer",
          fromUser: friend,
          toUser: viewer,
          fromPseudo: "Trade Friend",
          toPseudo: "Viewer",
          incoming: true,
          offeredCards: [],
          requestedCards: [],
          offeredKaras: 10,
          requestedKaras: 0,
          status: status.current,
          parentOfferId: null,
          createdAt: "2026-10-29T00:00:00Z"
        };
        return created.current ? [created.current, offer] : [offer];
      },
      context: async () => {
        setEvents(e => [...e, "context"]);
        return {
          friend: { id: friend, pseudo: "Trade Friend" },
          balance: 100,
          ownCards: [],
          friendCards: []
        };
      },
      create: async input => {
        setEvents(e => [...e, "create"]);
        if (input.parentOfferId) status.current = "countered";
        created.current = {
          id: "preview-created",
          fromUser: viewer,
          toUser: friend,
          fromPseudo: "Viewer",
          toPseudo: "Trade Friend",
          incoming: false,
          offeredCards: [],
          requestedCards: [],
          offeredKaras: input.offeredKaras,
          requestedKaras: input.requestedKaras,
          status: "pending",
          parentOfferId: input.parentOfferId ?? null,
          createdAt: "2026-10-29T00:01:00Z"
        };
        return "preview-created";
      },
      cancel: async () => {
        if (created.current)
          created.current = { ...created.current, status: "cancelled" };
        mutated.current = true;
        setEvents(e => [...e, "cancel"]);
        return true;
      },
      respond: async (_id, action) => {
        if (reject) {
          status.current = "cancelled";
          setEvents(e => [...e, "rejected"]);
          throw Error("This offer is no longer pending.");
        }
        status.current = action === "accept" ? "accepted" : "declined";
        mutated.current = true;
        setEvents(e => [...e, action]);
        return action === "accept";
      }
    }),
    [slow, failRefresh, reject]
  );
  const friendsAdapter = useMemo<FriendsPanelAdapter>(
    () => ({
      friendships: async () => ({
        friends: [{ id: friend, pseudo: "Trade Friend" }],
        incoming: [],
        outgoing: []
      }),
      search: async () => [],
      respond: async () => true,
      remove: async () => true,
      trades: adapter
    }),
    [adapter]
  );
  return (
    <main className="p-4">
      <output className="block break-all" data-trade-test-events>
        {events.join(",")}
      </output>
      {entry === "friends" ? (
        <FriendsPanel
          adapter={friendsAdapter}
          tradeSection={{
            ...route,
            routeKey: route.active ? "target" : "friends",
            content: (
              <TradesPanel
                adapter={adapter}
                fixedFriendId={route.friendId}
                pollIntervalMs={null}
              />
            ),
            open: id => {
              setEvents(e => [...e, "route-start"]);
              window.setTimeout(
                () => setRoute({ active: true, friendId: id }),
                1800
              );
            },
            close: () => {
              window.setTimeout(() => setRoute({ active: false }), 1800);
            }
          }}
        />
      ) : (
        <>
          <Button disabled={!ready} onClick={() => setOpen(true)}>
            Open trade test
          </Button>
          <Modal
            open={open}
            onClose={() => setOpen(false)}
            title="Trade path test"
            className="yk-private-trade-modal"
          >
            {open && (
              <TradesPanel
                adapter={adapter}
                initialOfferId={
                  entry === "notification" || entry === "targeted"
                    ? "preview-offer"
                    : undefined
                }
                fixedFriendId={
                  entry === "fixed" || entry === "targeted"
                    ? friend
                    : entry === "alias"
                      ? "Trade Friend"
                      : undefined
                }
                pollIntervalMs={null}
              />
            )}
          </Modal>
        </>
      )}
    </main>
  );
}
