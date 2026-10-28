"use client";

import { useState } from "react";
import { ProfileExperience, type ProfileAdapter } from "@/components/profile";
import {
  FriendsPanel,
  FriendAction,
  type FriendsPanelAdapter,
  type FriendActionAdapter
} from "@/components/friends";
import {
  AuctionChatPanel,
  type AuctionChatAdapter
} from "@/components/community-views";
import type { FriendshipStatus } from "@/lib/data/friends";
import type { Profile } from "@/lib/data/profile";
import type { ModerationAdapter, BlockedUser } from "@/lib/data/moderation";

const target = { id: "10000000-0000-4000-8000-000000000002", pseudo: "Mochi" };
const blockedTarget = {
  id: "10000000-0000-4000-8000-000000000003",
  pseudo: "Yuki"
};
function StateCases({
  context,
  record
}: {
  context: string;
  record: (value: string) => void;
}) {
  const [unblocked, setUnblocked] = useState(false);
  return (
    <section data-proof={context} className="yk-social-panel">
      <h2 className="yk-section-title">{context}</h2>
      <div className="yk-friend-proof-grid">
        {(
          [
            "none",
            "incoming",
            "incoming-refuse",
            "outgoing",
            "accepted",
            "blocked"
          ] as const
        ).map(state => {
          const id = `${context}:${state}`;
          const adapter: FriendActionAdapter = {
            send: async () => {
              record(id + ":send");
            },
            friendships: async () => ({
              friends: [],
              outgoing: [],
              incoming: [{ id, pseudo: "Mochi", requestId: id }]
            }),
            respond: async (_, accept) => {
              record(id + (accept ? ":accept" : ":decline"));
            },
            unblock: async () => {
              record(id + ":unblock");
            }
          };
          return (
            <div key={state} data-state={state}>
              <small>{state}</small>
              <FriendAction
                userId={id}
                status={
                  state === "blocked"
                    ? "none"
                    : state === "incoming-refuse"
                      ? "incoming"
                      : state
                }
                blockedByMe={state === "blocked" && !unblocked}
                onUnblocked={() => setUnblocked(true)}
                adapter={adapter}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
export function ModerationProof() {
  const [events, setEvents] = useState<string[]>([]);
  const record = (value: string) => setEvents(current => [...current, value]);
  const [fixture] = useState(() => {
    let status: FriendshipStatus = "accepted";
    let blocks: BlockedUser[] = [
      blockedTarget,
      { id: "10000000-0000-4000-8000-000000000004", pseudo: "Sora" }
    ];
    const moderation: ModerationAdapter = {
      list: async () => {
        record("list-blocked");
        return [...blocks];
      },
      block: async id => {
        blocks = [
          ...blocks.filter(x => x.id !== id),
          id === target.id ? target : blockedTarget
        ];
        status = "none";
        record("block:" + id);
      },
      unblock: async id => {
        blocks = blocks.filter(x => x.id !== id);
        status = "none";
        record("unblock:" + id);
      },
      report: async input => {
        record(
          "report:" +
            input.contextType +
            ":" +
            input.reason +
            ":" +
            input.details
        );
        if (input.blockAlso) await moderation.block(input.userId);
      }
    };
    const action: FriendActionAdapter = {
      send: async () => {
        status = "outgoing";
        record("send");
      },
      friendships: async () => ({ friends: [], incoming: [], outgoing: [] }),
      respond: async () => undefined,
      unblock: moderation.unblock
    };
    const profile: ProfileAdapter = {
      profile: async () =>
        ({
          ...target,
          avatarUrl: null,
          bio: "",
          bannerCard: null,
          friendshipStatus: status,
          isPublic: true,
          canViewCollection: true,
          featuredCards: [],
          friends: [],
          friendsVisible: true,
          cardCount: 0,
          distinctCardCount: 0
        }) satisfies Profile,
      wishlist: async () => [],
      blocked: moderation.list,
      moderation,
      friendAction: action
    };
    const friends: FriendsPanelAdapter = {
      friendships: async () => ({ friends: [], incoming: [], outgoing: [] }),
      search: async () => [{ ...blockedTarget, status: "none" }],
      respond: async () => undefined,
      remove: async () => undefined,
      moderation,
      action
    };
    const chat: AuctionChatAdapter = {
      get: async () => ({
        canPost: true,
        participants: [],
        messages: blocks.some(x => x.id === target.id)
          ? []
          : [
              {
                id: "10000000-0000-4000-8000-000000000010",
                userId: target.id,
                pseudo: target.pseudo,
                message: "Message à signaler",
                createdAt: "2026-10-08T10:00:00Z",
                mine: false
              }
            ]
      }),
      send: async (_, message) => ({
        id: "sent",
        userId: "me",
        pseudo: "Moi",
        message,
        createdAt: new Date().toISOString(),
        mine: true
      }),
      moderation
    };
    return { profile, friends, chat };
  });
  return (
    <div className="yk-social-stack">
      <section data-proof="profile">
        <h2 className="yk-section-title mb-6">Profil public réel</h2>
        <ProfileExperience identifier="Mochi" adapter={fixture.profile} />
      </section>
      <section data-proof="friends">
        <h2 className="yk-section-title mb-6">Page Amis réelle</h2>
        <FriendsPanel adapter={fixture.friends} />
      </section>
      <section data-proof="chat">
        <AuctionChatPanel
          auctionId="fixture"
          refreshKey={0}
          finished={false}
          adapter={fixture.chat}
        />
      </section>
      <StateCases context="Profil : états" record={record} />
      <StateCases context="Amis : états" record={record} />
      <pre id="moderation-proof-log" className="whitespace-pre-wrap">
        {events.join("\n")}
      </pre>
    </div>
  );
}
