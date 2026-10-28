"use client";
import { gameErrorKey } from "@/i18n/game-messages";
import { useTranslations } from "next-intl";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { PrivateMessages } from "@/components/private-messages";
import { useSocialUnread } from "@/hooks/use-social-unread";
import {
  invalidateSocialUnread,
  type SocialUnreadAdapter
} from "@/lib/data/social-unread";
import { UnreadBadge } from "@/components/unread-badge";
import type { PrivateMessagesAdapter } from "@/lib/data/private-messages";
import type { TradesPanelAdapter } from "@/components/trades";
import {
  Avatar,
  Button,
  Modal,
  Skeleton,
  StatusPill,
  Tabs
} from "@/components/ui";
import {
  getFriendships,
  getFriendshipsPage,
  groupFriendships,
  friendshipItems,
  removeFriend,
  respondFriendRequest,
  searchUsers,
  sendFriendRequest,
  type Friendships,
  type FriendUser,
  type FriendshipStatus
} from "@/lib/data/friends";

import {
  liveModeration,
  type BlockedUser,
  type ModerationAdapter
} from "@/lib/data/moderation";

export type FriendActionAdapter = {
  unblock?: (userId: string) => Promise<unknown>;
  send: (userId: string) => Promise<unknown>;
  friendships?: () => Promise<Friendships>;
  respond: (requestId: string, accept: boolean) => Promise<unknown>;
};
const liveFriendActions: FriendActionAdapter = {
  send: sendFriendRequest,
  friendships: getFriendships,
  respond: respondFriendRequest
};

export function FriendAction({
  userId,
  status,
  requestId,
  onCancel,
  blockedByMe = false,
  onChanged,
  onUnblocked,
  adapter = liveFriendActions
}: {
  userId: string;
  status: FriendshipStatus;
  requestId?: string;
  onCancel?: () => Promise<unknown>;
  blockedByMe?: boolean;
  onChanged?: (status: FriendshipStatus) => void;
  onUnblocked?: () => void;
  adapter?: FriendActionAdapter;
}) {
  const t = useTranslations();
  const [state, setState] = useState(status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmRefusal, setConfirmRefusal] = useState(false);
  async function send() {
    setBusy(true);
    setError("");
    try {
      await adapter.send(userId);
      setState("outgoing");
      onChanged?.("outgoing");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't complete this action."
      );
    } finally {
      setBusy(false);
    }
  }
  async function respond(accept: boolean) {
    setBusy(true);
    setError("");
    try {
      const id =
        requestId ??
        (await adapter.friendships?.())?.incoming.find(
          person => person.id === userId
        )?.requestId;
      if (!id) throw new Error("This request is no longer available.");
      await adapter.respond(id, accept);
      setState(accept ? "accepted" : "none");
      setConfirmRefusal(false);
      onChanged?.(accept ? "accepted" : "none");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't complete this action."
      );
    } finally {
      setBusy(false);
    }
  }
  async function unblock() {
    setBusy(true);
    setError("");
    try {
      await (adapter.unblock ?? liveModeration.unblock)(userId);
      setState("none");
      onUnblocked?.();
      onChanged?.("none");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't complete this action."
      );
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!onCancel || busy) return;
    setBusy(true);
    setError("");
    try {
      await onCancel();
      setState("none");
      onChanged?.("none");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't complete this action."
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="yk-friend-action">
      {blockedByMe && (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void unblock()}
        >
          {t("profileUi.unblock")}{" "}
        </Button>
      )}
      {!blockedByMe && state === "none" && (
        <Button variant="secondary" disabled={busy} onClick={() => void send()}>
          <span aria-hidden="true">＋</span> {t("profileUi.addFriend")}{" "}
        </Button>
      )}
      {!blockedByMe && state === "incoming" && (
        <div className="yk-friend-action-buttons">
          <Button disabled={busy} onClick={() => void respond(true)}>
            {t("profileUi.accept")}{" "}
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setConfirmRefusal(true)}
          >
            {t("profileUi.decline")}{" "}
          </Button>
        </div>
      )}
      {!blockedByMe &&
        (state === "outgoing" || state === "accepted" || state === "self") && (
          <StatusPill tone={state === "accepted" ? "success" : "gold"}>
            {t(`profileUi.friendStatus${state}`)}
          </StatusPill>
        )}
      {error && (
        <p role="alert" className="yk-inline-error">
          {t(gameErrorKey(error, "profileUi.profileUnavailable"))}
        </p>
      )}
      {!blockedByMe && state === "outgoing" && onCancel && (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void cancel()}
        >
          {t("profileUi.cancelRequest")}{" "}
        </Button>
      )}
      <Modal
        open={confirmRefusal}
        onClose={() => setConfirmRefusal(false)}
        title={t("profileUi.declineThisRequest")}
        className="max-w-md"
      >
        <p className="text-sm leading-6 text-ink-2">
          {t("profileUi.declineRequestNotice")}{" "}
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setConfirmRefusal(false)}>
            {t("packs.cancel")}{" "}
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => void respond(false)}
          >
            {busy ? t("profileUi.declining") : t("profileUi.decline")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export function friendPresenceLabel(
  person: Pick<FriendUser, "isOnline" | "lastSeenAt">,
  now = Date.now()
) {
  if (person.isOnline) return "Online";
  if (!person.lastSeenAt) return "Not seen online yet";
  const elapsed = Math.max(0, now - new Date(person.lastSeenAt).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Seen just now";
  if (minutes < 60)
    return `Last seen ${minutes.toLocaleString("en-US")} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return `Last seen ${hours.toLocaleString("en-US")} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7)
    return `Last seen ${days.toLocaleString("en-US")} ${days === 1 ? "day" : "days"} ago`;
  return `Last seen ${new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeStyle: "short" }).format(new Date(person.lastSeenAt))}`;
}

function Person({
  person,
  actions,
  onMessage,
  onTrade,
  unreadCount = 0,
  showPresence = false
}: {
  person: FriendUser;
  actions?: ReactNode;
  onMessage?: () => void;
  onTrade?: () => void;
  unreadCount?: number;
  showPresence?: boolean;
}) {
  const tradeText = useTranslations("socialTrades");
  return (
    <li className="yk-social-person">
      <Avatar
        name={person.pseudo}
        image={person.avatarUrl ?? undefined}
        online={showPresence ? person.isOnline : undefined}
      />
      <Link href={`/profile/${encodeURIComponent(person.pseudo)}`}>
        <strong>{person.pseudo}</strong>
        <small
          className={
            showPresence && person.isOnline ? "yk-presence-online" : undefined
          }
        >
          {showPresence ? friendPresenceLabel(person) : "View profile"}
        </small>
      </Link>
      {actions && (
        <div
          className={`yk-friend-action-buttons${onTrade ? " has-trade" : ""}`}
        >
          {onTrade && (
            <Button
              variant="secondary"
              onClick={onTrade}
              aria-label={tradeText("tradeWith", { name: person.pseudo })}
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4" />
              </svg>
              {tradeText("action")}
            </Button>
          )}
          {onMessage && (
            <Button
              variant="secondary"
              aria-label={`Message ${person.pseudo}`}
              onClick={onMessage}
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                aria-hidden="true"
              >
                <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-3 2V11.5a10 10 0 0 1 20 0Z" />
                <path d="M7 10h9M7 14h6" />
              </svg>
              Message
              <UnreadBadge
                count={unreadCount}
                label="unread messages"
                singularLabel="unread message"
              />
            </Button>
          )}
          {actions}
        </div>
      )}
    </li>
  );
}
type FriendsTab = "friends" | "incoming" | "outgoing" | "blocked";
const emptyCopy: Record<FriendsTab, { title: string; text: string }> = {
  blocked: {
    title: "No blocked players",
    text: "Players you block will appear here."
  },
  friends: {
    title: "Your circle is still empty",
    text: "Search for a username to invite your first friend."
  },
  incoming: {
    title: "No incoming requests",
    text: "New invitations will appear here."
  },
  outgoing: {
    title: "No sent requests",
    text: "Your pending invitations will appear here."
  }
};

export type FriendsPanelAdapter = {
  friendships: () => Promise<Friendships>;
  search: (query: string) => Promise<FriendUser[]>;
  respond: (requestId: string, accept: boolean) => Promise<unknown>;
  remove: (friendId: string) => Promise<unknown>;
  action?: FriendActionAdapter;
  moderation?: ModerationAdapter;
  messages?: PrivateMessagesAdapter;
  unread?: SocialUnreadAdapter;
  trades?: TradesPanelAdapter;
};
const liveFriendsPanel: FriendsPanelAdapter = {
  friendships: getFriendships,
  search: searchUsers,
  respond: respondFriendRequest,
  remove: removeFriend
};

export function FriendsPanel({
  adapter = liveFriendsPanel,
  initialConversationId,
  onConversationClose,
  tradeSection
}: {
  adapter?: FriendsPanelAdapter;
  initialConversationId?: string;
  onConversationClose?: () => void;
  tradeSection?: {
    active: boolean;
    content: ReactNode;
    open: (friendId?: string) => void;
    close: () => void;
  };
} = {}) {
  const tradeText = useTranslations("socialTrades");
  const pager = useMemo(
    () =>
      import("@/lib/data/demand-pages").then(({ createDemandPager }) =>
        createDemandPager(
          adapter === liveFriendsPanel
            ? getFriendshipsPage
            : async () => ({
                items: friendshipItems(await adapter.friendships()),
                nextCursor: null
              }),
          item => item.friend.requestId ?? item.friend.id
        )
      ),
    [adapter]
  );
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  async function readFriends(more = false) {
    const current = await pager;
    const page = await (more ? current.more() : current.refresh());
    setHasMore(!!page.nextCursor);
    return groupFriendships(page.items);
  }
  async function loadMore() {
    setLoadingMore(true);
    setError("");
    try {
      setData(await readFriends(true));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Couldn't load more friends. Please try again."
      );
    } finally {
      setLoadingMore(false);
    }
  }
  const [blocked, setBlocked] = useState<BlockedUser[]>([]);
  const social = useSocialUnread(
    adapter.unread,
    adapter === liveFriendsPanel || !!adapter.unread
  );
  const moderation = adapter.moderation ?? liveModeration;
  const [data, setData] = useState<Friendships>();
  const [tab, setTab] = useState<FriendsTab>("friends");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FriendUser[]>([]);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const [refusal, setRefusal] = useState<FriendUser>();
  const [removal, setRemoval] = useState<FriendUser>();
  const [removing, setRemoving] = useState(false);
  const [conversation, setConversation] = useState<FriendUser>();
  const openedFromNotification = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!initialConversationId) {
      openedFromNotification.current = undefined;
      return;
    }
    if (!data || openedFromNotification.current === initialConversationId)
      return;
    const frame = window.requestAnimationFrame(() => {
      openedFromNotification.current = initialConversationId;
      const friend = data.friends.find(
        person => person.id === initialConversationId
      );
      if (friend) {
        setTab("friends");
        setConversation(friend);
      } else setError("This conversation is no longer available.");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [data, initialConversationId]);
  useEffect(() => {
    let active = true;
    void moderation.list().then(
      value => {
        if (active) setBlocked(value);
      },
      e => {
        if (active)
          setError(e instanceof Error ? e.message : "Couldn't load friends.");
      }
    );
    return () => {
      active = false;
    };
  }, [moderation]);
  async function unblock(id: string) {
    setError("");
    try {
      await moderation.unblock(id);
      setBlocked(current => current.filter(person => person.id !== id));
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't complete this action."
      );
    }
  }
  async function load() {
    try {
      setData(await readFriends());
      invalidateSocialUnread();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load friends.");
    }
  }
  useEffect(() => {
    let active = true;
    let loading = false;
    const refresh = async () => {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      try {
        const page = await (await pager).refresh();
        const value = groupFriendships(page.items);
        if (active) {
          setData(value);
          setHasMore(!!page.nextCursor);
        }
      } catch (e) {
        if (active)
          setError(e instanceof Error ? e.message : "Couldn't load friends.");
      } finally {
        loading = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [adapter, pager]);
  useEffect(() => {
    if (query.trim().length < 2) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setResults([]);
      setSearching(true);
      void adapter
        .search(query)
        .then(
          value => {
            if (active) setResults(value);
          },
          e => {
            if (active)
              setError(e instanceof Error ? e.message : "Couldn't search.");
          }
        )
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query, adapter]);
  async function respond(id: string, accept: boolean) {
    setError("");
    try {
      await adapter.respond(id, accept);
      setRefusal(undefined);
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't complete this action."
      );
    }
  }
  async function remove() {
    if (!removal || removing) return;
    setRemoving(true);
    setError("");
    try {
      await adapter.remove(removal.id);
      setRemoval(undefined);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove this friend.");
    } finally {
      setRemoving(false);
    }
  }
  const lists = {
    blocked,
    friends: data?.friends ?? [],
    incoming: data?.incoming ?? [],
    outgoing: data?.outgoing ?? []
  };
  const current: FriendUser[] = lists[tab];
  return (
    <div className="yk-social-stack">
      {!tradeSection?.active && (
        <section className="yk-social-search">
          <div>
            <p className="eyebrow">Find a player</p>
            <h2 className="yk-section-title mt-2">Grow your circle</h2>
          </div>
          <label className="yk-social-search-field">
            <span aria-hidden="true">⌕</span>
            <input
              aria-label="Search players by username"
              value={query}
              onChange={e => {
                setQuery(e.target.value);
                setResults([]);
                setSearching(e.target.value.trim().length >= 2);
              }}
              placeholder="Search usernames…"
            />
          </label>
          {query.trim().length > 0 && query.trim().length < 2 && (
            <p className="yk-search-hint">Enter at least two characters.</p>
          )}
          {searching && (
            <p className="yk-search-hint" role="status">
              Searching…
            </p>
          )}
          {query.trim().length >= 2 && !searching && !results.length && (
            <div className="yk-social-empty is-compact">
              <strong>No players found</strong>
              <span>Try another username.</span>
            </div>
          )}
          {!!results.length && (
            <ul className="yk-social-list is-search">
              {results.map(person => (
                <Person
                  key={person.id}
                  person={person}
                  actions={
                    <FriendAction
                      key={`${person.id}:${person.status}:${blocked.some(item => item.id === person.id)}`}
                      userId={person.id}
                      status={person.status ?? "none"}
                      blockedByMe={blocked.some(item => item.id === person.id)}
                      onUnblocked={() =>
                        setBlocked(current =>
                          current.filter(item => item.id !== person.id)
                        )
                      }
                      onChanged={() => void load()}
                      adapter={
                        adapter.action
                          ? { ...adapter.action, unblock: moderation.unblock }
                          : {
                              ...liveFriendActions,
                              unblock: moderation.unblock
                            }
                      }
                    />
                  }
                />
              ))}
            </ul>
          )}
        </section>
      )}
      <section className="yk-social-panel">
        <Tabs
          label="Relationships"
          value={tradeSection?.active ? "trades" : tab}
          onChange={value => {
            if (value === "trades") tradeSection?.open();
            else {
              setTab(value as FriendsTab);
              if (tradeSection?.active) tradeSection.close();
            }
          }}
          items={[
            {
              id: "friends",
              label: `My friends · ${lists.friends.length.toLocaleString("en-US")}${hasMore ? "+" : ""}`
            },
            ...(tradeSection
              ? [{ id: "trades", label: tradeText("tab") }]
              : []),
            {
              id: "incoming",
              badge: lists.incoming.length ? (
                <span className="ml-2 inline-flex">
                  <UnreadBadge
                    count={lists.incoming.length}
                    label="pending friend requests"
                    singularLabel="pending friend request"
                  />
                </span>
              ) : undefined,
              label: `Received requests · ${lists.incoming.length.toLocaleString("en-US")}`
            },
            {
              id: "outgoing",
              label: `Sent requests · ${lists.outgoing.length.toLocaleString("en-US")}`
            },
            {
              id: "blocked",
              label: `Blocked · ${blocked.length.toLocaleString("en-US")}`
            }
          ]}
        />
        {tradeSection?.active ? (
          <div className="yk-friends-trades">{tradeSection.content}</div>
        ) : !data && tab !== "blocked" ? (
          !error && (
            <Skeleton
              label="Loading relationships"
              className="mt-4 h-48 w-full rounded-panel"
            />
          )
        ) : current.length ? (
          <ul className="yk-social-list">
            {current.map(person => (
              <Person
                key={person.requestId ?? person.id}
                person={person}
                showPresence={tab === "friends"}
                unreadCount={
                  social?.messages.find(item => item.friendId === person.id)
                    ?.count ?? 0
                }
                onMessage={
                  tab === "friends" ? () => setConversation(person) : undefined
                }
                onTrade={
                  tab === "friends" && tradeSection
                    ? () => tradeSection.open(person.id)
                    : undefined
                }
                actions={
                  tab === "blocked" ? (
                    <Button
                      variant="secondary"
                      onClick={() => void unblock(person.id)}
                    >
                      Unblock
                    </Button>
                  ) : tab === "incoming" ? (
                    <div className="yk-friend-action-buttons">
                      <Button
                        onClick={() => void respond(person.requestId!, true)}
                      >
                        Accept
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => setRefusal(person)}
                      >
                        Decline
                      </Button>
                    </div>
                  ) : tab === "friends" ? (
                    <Button variant="danger" onClick={() => setRemoval(person)}>
                      Remove
                    </Button>
                  ) : (
                    <StatusPill tone="gold">Pending</StatusPill>
                  )
                }
              />
            ))}
          </ul>
        ) : (
          <div className="yk-social-empty">
            <span className="yk-social-empty-icon" aria-hidden="true">
              ◇
            </span>
            <strong>
              {hasMore && tab !== "blocked"
                ? "No relationships loaded in this tab yet"
                : emptyCopy[tab].title}
            </strong>
            <p>
              {hasMore && tab !== "blocked"
                ? "Load more to continue through your relationships."
                : emptyCopy[tab].text}
            </p>
          </div>
        )}
        {!tradeSection?.active && tab !== "blocked" && hasMore && (
          <Button
            variant="secondary"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        )}
        {!tradeSection?.active && data && !hasMore && tab !== "blocked" && (
          <p role="status" className="sr-only">
            All relationships loaded.
          </p>
        )}
      </section>
      {error && (
        <p role="alert" className="yk-social-alert">
          {error}
        </p>
      )}
      {conversation && (
        <PrivateMessages
          key={conversation.id}
          friend={conversation}
          adapter={adapter.messages}
          tradeAdapter={adapter.trades}
          onClose={() => {
            setConversation(undefined);
            onConversationClose?.();
          }}
          moderationAdapter={adapter.moderation}
        />
      )}
      <Modal
        open={!!refusal}
        onClose={() => setRefusal(undefined)}
        title="Decline this request?"
        className="max-w-md"
      >
        <p className="text-sm leading-6 text-ink-2">
          The request from{" "}
          <strong className="text-ink">{refusal?.pseudo}</strong> will be
          removed.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setRefusal(undefined)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() =>
              refusal?.requestId && void respond(refusal.requestId, false)
            }
          >
            Decline
          </Button>
        </div>
      </Modal>
      <Modal
        open={!!removal}
        onClose={() => {
          if (!removing) setRemoval(undefined);
        }}
        title="Remove this friend?"
        className="max-w-md"
      >
        <p className="text-sm leading-6 text-ink-2">
          <strong className="text-ink">{removal?.pseudo}</strong> will be
          removed from your friends list. You can send them a new request later.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="secondary"
            disabled={removing}
            onClick={() => setRemoval(undefined)}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={removing}
            onClick={() => void remove()}
          >
            {removing ? "Suppression…" : "Remove"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
