"use client";
/* eslint-disable @next/next/no-img-element -- GIPHY media must remain animated. */

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode
} from "react";
import { useTranslations } from "next-intl";
import { Avatar, Button, Modal } from "@/components/ui";
import { GifPicker, type GifChoice } from "@/components/gif-picker";
import { TradesPanel, type TradesPanelAdapter } from "@/components/trades";
import { ConversationTrade } from "@/components/conversation-trade";
import { useConversationTrades } from "@/hooks/use-conversation-trades";
import { conversationTimeline } from "@/lib/ui/conversation-trades";
import { PlayerModeration } from "@/components/player-moderation";
import type { ModerationAdapter } from "@/lib/data/moderation";
import type { FriendUser } from "@/lib/data/friends";
import {
  livePrivateMessages,
  PrivateMessagesError,
  isPrivateMessageGif,
  type PrivateMessage,
  type PrivateMessagePage,
  type PrivateMessagesAdapter
} from "@/lib/data/private-messages";
import { startVisiblePolling } from "@/lib/ui/visible-polling";

function mergeMessages(first: PrivateMessage[], second: PrivateMessage[]) {
  return [
    ...new Map(
      [...first, ...second].map(message => [message.id, message])
    ).values()
  ].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  );
}
const time = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit"
});
const date = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric"
});

function DockedMessageFrame({
  children,
  className
}: {
  children: ReactNode;
  className?: string;
  open?: boolean;
  title: string;
  onClose: () => void;
}) {
  return (
    <div className={`yk-messenger-thread ${className ?? ""}`}>{children}</div>
  );
}

export function PrivateMessages({
  friend,
  onClose,
  tradeAdapter,
  moderationAdapter,
  docked = false,
  adapter = livePrivateMessages
}: {
  friend: FriendUser;
  onClose: () => void;
  adapter?: PrivateMessagesAdapter;
  tradeAdapter?: TradesPanelAdapter;
  moderationAdapter?: ModerationAdapter;
  docked?: boolean;
}) {
  const MessageFrame = docked ? DockedMessageFrame : Modal;
  const t = useTranslations("privateMessages");
  const [page, setPage] = useState<PrivateMessagePage>();
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [gif, setGif] = useState<GifChoice | null>(null);
  const [trading, setTrading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sendError, setSendError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [retry, setRetry] = useState(0);
  const [visibleTrades, setVisibleTrades] = useState(20);
  const trades = useConversationTrades(
    page?.viewerId,
    friend.id,
    !!page && !unavailable,
    tradeAdapter
  );
  const timeline = conversationTimeline(
    page?.items ?? [],
    trades.offers,
    visibleTrades
  );
  const scroll = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const pending = useRef<{
    text: string;
    gifUrl: string | null;
    id: string;
  } | null>(null);
  const sendingRef = useRef(false);
  const mounted = useRef(true);
  const scrollRestore = useRef<{ height: number; top: number } | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    let reading = false;
    const refresh = async () => {
      if (!active || reading) return;
      reading = true;
      try {
        const fresh = await adapter.list(friend.id);
        if (!active) return;
        setPage(current => {
          // A long hidden-tab gap starts a fresh bounded window. Older messages
          // remain reachable through the server cursor instead of leaving a gap.
          if (
            !current ||
            current.viewerId !== fresh.viewerId ||
            (fresh.next &&
              current.items.length &&
              !fresh.items.some(message =>
                current.items.some(old => old.id === message.id)
              ))
          )
            return fresh;
          return {
            ...current,
            viewerId: fresh.viewerId,
            readThroughId: fresh.readThroughId ?? current.readThroughId,
            items: mergeMessages(current.items, fresh.items)
          };
        });
        setError("");
        setUnavailable(false);
      } catch (reason) {
        if (!active) return;
        setError(
          reason instanceof Error
            ? reason.message
            : "Couldn't load messages. Please try again."
        );
        if (reason instanceof PrivateMessagesError && reason.unavailable) {
          setPage(undefined);
          setUnavailable(true);
        }
      } finally {
        reading = false;
        if (active) setLoading(false);
      }
    };
    const stop = startVisiblePolling(() => void refresh(), 5_000);
    const onFocus = () => {
      if (!document.hidden) void refresh();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    window.addEventListener("private-message-received", onFocus);
    const blocked = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; blocked: boolean }>)
        .detail;
      if (detail?.id === friend.id && detail.blocked) {
        active = false;
        setPage(undefined);
        setUnavailable(true);
        setError("This conversation is no longer available.");
        setTrading(false);
      }
    };
    window.addEventListener("player-block-changed", blocked);
    return () => {
      active = false;
      stop();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
      window.removeEventListener("private-message-received", onFocus);
      window.removeEventListener("player-block-changed", blocked);
    };
  }, [adapter, friend.id, retry]);

  useEffect(() => {
    // Run after rendering a successfully fetched page, not when opening the
    // bell, loading older history, failing a fetch or switching to a hidden tab.
    if (!adapter.markRead || !page?.readThroughId || unavailable || trading)
      return;
    let active = true;
    let busy = false;
    let confirmed = false;
    const acknowledge = async () => {
      if (!active || document.hidden || busy || confirmed) return;
      busy = true;
      try {
        await adapter.markRead!(friend.id, page.readThroughId!);
        if (active) confirmed = true;
      } catch {
        /* Retry without clearing the last confirmed unread badge. */
      } finally {
        busy = false;
      }
    };
    const stop = startVisiblePolling(() => void acknowledge(), 5_000);
    return () => {
      active = false;
      stop();
    };
  }, [
    adapter,
    friend.id,
    page?.viewerId,
    page?.readThroughId,
    unavailable,
    trading
  ]);

  useEffect(() => {
    const viewport = scroll.current;
    if (!viewport) return;
    if (scrollRestore.current) {
      viewport.scrollTop =
        scrollRestore.current.top +
        viewport.scrollHeight -
        scrollRestore.current.height;
      scrollRestore.current = null;
    } else if (stickToBottom.current)
      viewport.scrollTop = viewport.scrollHeight;
  }, [page, trades.offers, visibleTrades]);

  async function older() {
    if (!page?.next || loadingOlder || unavailable) return;
    setLoadingOlder(true);
    try {
      const olderPage = await adapter.list(friend.id, page.next);
      if (!mounted.current) return;
      const viewport = scroll.current;
      if (viewport)
        scrollRestore.current = {
          height: viewport.scrollHeight,
          top: viewport.scrollTop
        };
      setPage(
        current =>
          current && {
            ...current,
            readThroughId: current.readThroughId ?? olderPage.readThroughId,
            items: mergeMessages(olderPage.items, current.items),
            next: olderPage.next
          }
      );
      setError("");
    } catch (reason) {
      if (!mounted.current) return;
      setError(
        reason instanceof Error
          ? reason.message
          : "Couldn't load older messages."
      );
      if (reason instanceof PrivateMessagesError && reason.unavailable) {
        setPage(undefined);
        setUnavailable(true);
      }
    } finally {
      if (mounted.current) setLoadingOlder(false);
    }
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (
      (!text && !gif) ||
      Array.from(text).length > 2000 ||
      !page ||
      unavailable ||
      sendingRef.current
    )
      return;
    sendingRef.current = true;
    setSending(true);
    setSendError("");
    const gifUrl = gif?.url ?? null;
    if (
      !pending.current ||
      pending.current.text !== text ||
      pending.current.gifUrl !== gifUrl
    )
      pending.current = { text, gifUrl, id: crypto.randomUUID() };
    try {
      const message = await adapter.send(
        friend.id,
        text,
        pending.current.id,
        gifUrl
      );
      if (!mounted.current) return;
      stickToBottom.current = true;
      setPage(
        current =>
          current && {
            ...current,
            items: mergeMessages(current.items, [message])
          }
      );
      setDraft("");
      setGif(null);
      pending.current = null;
    } catch (reason) {
      if (!mounted.current) return;
      setSendError(
        reason instanceof Error
          ? reason.message
          : "Couldn't send the message. Your draft has been kept."
      );
      if (reason instanceof PrivateMessagesError && reason.unavailable) {
        setPage(undefined);
        setUnavailable(true);
      }
    } finally {
      sendingRef.current = false;
      if (mounted.current) {
        setSending(false);
        requestAnimationFrame(() => {
          if (mounted.current) composer.current?.focus();
        });
      }
    }
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <>
      <MessageFrame
        open
        onClose={onClose}
        title={`Messages with ${friend.pseudo}`}
        className="yk-private-messages-modal"
      >
        <div className="yk-private-messages-contact">
          <Avatar
            name={friend.pseudo}
            size={docked ? 32 : 40}
            image={friend.avatarUrl ?? undefined}
            online={friend.isOnline}
          />
          <div>
            <strong>{friend.pseudo}</strong>
            <p>Only you and your friend can access this conversation.</p>
          </div>
          <Button
            variant="secondary"
            disabled={loading || unavailable || !page}
            onClick={() => setTrading(true)}
          >
            Trade
          </Button>
          <PlayerModeration
            userId={friend.id}
            pseudo={friend.pseudo}
            adapter={moderationAdapter}
            onBlocked={onClose}
          />
        </div>
        <div
          className="yk-private-messages-log"
          ref={scroll}
          role="log"
          aria-label="Conversation"
          aria-live="polite"
          aria-relevant="additions text"
          aria-busy={loading}
          onScroll={() => {
            const viewport = scroll.current;
            if (viewport)
              stickToBottom.current =
                viewport.scrollHeight -
                  viewport.scrollTop -
                  viewport.clientHeight <
                60;
          }}
        >
          {page?.next && (
            <div className="yk-private-messages-older">
              <Button
                variant="secondary"
                disabled={loadingOlder}
                onClick={() => void older()}
              >
                {loadingOlder ? "Loading…" : "Load older messages"}
              </Button>
            </div>
          )}
          {trades.offers.length > visibleTrades && (
            <div className="yk-private-messages-older">
              <Button
                variant="secondary"
                onClick={() => {
                  const viewport = scroll.current;
                  if (viewport)
                    scrollRestore.current = {
                      height: viewport.scrollHeight,
                      top: viewport.scrollTop
                    };
                  setVisibleTrades(value => value + 20);
                }}
              >
                Show older trades
              </Button>
            </div>
          )}
          {loading ? (
            <p className="yk-private-messages-empty" role="status">
              Loading messages…
            </p>
          ) : page && !timeline.length ? (
            <div className="yk-private-messages-empty">
              <strong>Start a conversation</strong>
              <p>Say hello to {friend.pseudo}.</p>
            </div>
          ) : null}
          {trades.loading && (
            <p className="yk-conversation-trades-status" role="status">
              Loading trade offers…
            </p>
          )}
          {timeline.map(entry => {
            if (!page) return null;
            if (entry.kind === "trade")
              return (
                <ConversationTrade
                  key={entry.id}
                  offer={entry.offer}
                  viewerId={page.viewerId}
                  busy={!!trades.busyId || unavailable}
                  onRespond={(id, action) => {
                    void trades.respond(id, action);
                  }}
                />
              );
            const message = entry.message;
            const own = message.senderId === page.viewerId;
            return (
              <div
                className={`yk-private-message${own ? " is-own" : ""}`}
                key={entry.id}
              >
                {message.moderated && (
                  <p className="yk-private-message-removed">
                    {t("removedByModeration")}
                  </p>
                )}
                {message.text && <p>{message.text}</p>}
                {message.gifUrl && isPrivateMessageGif(message.gifUrl) && (
                  <img
                    className="yk-private-message-gif"
                    src={message.gifUrl}
                    alt="GIF from GIPHY"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onLoad={() => {
                      if (stickToBottom.current && scroll.current)
                        scroll.current.scrollTop = scroll.current.scrollHeight;
                    }}
                  />
                )}
                <time
                  dateTime={message.createdAt}
                  title={new Date(message.createdAt).toLocaleString("en-US")}
                >
                  <span className="sr-only">
                    {own ? "You" : friend.pseudo},{" "}
                  </span>
                  {date.format(new Date(message.createdAt))} ·{" "}
                  {time.format(new Date(message.createdAt))}
                </time>
                {!own && !message.moderated && (
                  <PlayerModeration
                    userId={friend.id}
                    pseudo={friend.pseudo}
                    adapter={moderationAdapter}
                    contextType="private_message"
                    contextId={message.id}
                    onBlocked={onClose}
                  />
                )}
              </div>
            );
          })}
        </div>
        {trades.error && !unavailable && (
          <div className="yk-private-messages-error">
            <p role="alert">{trades.error}</p>
            <button
              type="button"
              disabled={!!trades.busyId}
              onClick={() => void trades.retry()}
            >
              Retry trades
            </button>
          </div>
        )}
        {(sendError || error) && (
          <div className="yk-private-messages-error">
            <p role="alert">{sendError || error}</p>
            {!unavailable && !sendError && (
              <button
                type="button"
                onClick={() => setRetry(value => value + 1)}
              >
                Try again
              </button>
            )}
          </div>
        )}
        <form
          className="yk-private-messages-compose"
          onSubmit={event => void send(event)}
        >
          {gif && (
            <div className="yk-private-messages-gif-draft">
              <img
                src={gif.url}
                alt={`Selected GIF: ${gif.title}`}
                referrerPolicy="no-referrer"
              />
              <button
                type="button"
                disabled={sending}
                aria-label="Remove selected GIF"
                onClick={() => setGif(null)}
              >
                Remove GIF
              </button>
            </div>
          )}
          <label className="sr-only" htmlFor="private-message-draft">
            Message to {friend.pseudo}
          </label>
          <textarea
            ref={composer}
            id="private-message-draft"
            placeholder={`Message ${friend.pseudo}…`}
            value={draft}
            maxLength={2000}
            rows={3}
            disabled={sending || loading || unavailable || !page}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            aria-describedby="private-message-hint"
          />
          <div>
            <div className="yk-private-messages-tools">
              <GifPicker
                disabled={sending || loading || unavailable || !page}
                onSelect={choice => {
                  if (!isPrivateMessageGif(choice.url)) {
                    setSendError("Choose a GIF from the GIPHY picker.");
                    return;
                  }
                  setGif(choice);
                  setSendError("");
                }}
              />
            </div>
            <span id="private-message-hint">
              Enter to send · Shift + Enter for a new line{" "}
              <small>{draft.length.toLocaleString("en-US")} / 2,000</small>
            </span>
            <Button
              type="submit"
              disabled={
                sending ||
                loading ||
                unavailable ||
                !page ||
                (!draft.trim() && !gif)
              }
            >
              {sending ? "Sending…" : "Send message"}
            </Button>
          </div>
        </form>
      </MessageFrame>
      {trading && (
        <Modal
          open
          title={`Trade with ${friend.pseudo}`}
          onClose={() => setTrading(false)}
          className="yk-private-trade-modal"
        >
          {tradeAdapter && (
            <p className="yk-private-trade-preview-note">
              Local trade preview. No real offer is sent.
            </p>
          )}
          <TradesPanel
            adapter={tradeAdapter}
            fixedFriendId={friend.id}
            onOfferSent={() => {
              setTrading(false);
              stickToBottom.current = true;
              void trades.refresh();
            }}
          />
        </Modal>
      )}
    </>
  );
}
