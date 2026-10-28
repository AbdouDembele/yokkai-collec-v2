"use client";

import { cardRarityLabel } from "@/lib/ui/card-rarity-label";
import { startVisiblePolling } from "@/lib/ui/visible-polling";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Avatar,
  Button,
  Chip,
  Feedback,
  Karas,
  Modal,
  StatusPill,
  Tabs
} from "@/components/ui";
import { YokaiCard } from "@/components/yokai-card";
import { CardFranchise } from "@/components/card-franchise";
import {
  getFriendships,
  getFriendshipsPage,
  groupFriendships,
  friendshipItems,
  type FriendUser
} from "@/lib/data/friends";
import {
  cancelTradeOffer,
  counterTradeDraft,
  createTradeOffer,
  filterTradeOffers,
  getTradeContext,
  hasNewAcceptedTrade,
  listTradeOffers,
  listTradeOffersPage,
  loadTradeContextIfCurrent,
  respondTradeOffer,
  resolveTradeReview,
  runTradeCancellation,
  tradeStatusPresentation,
  tradeOfferIsActionable,
  tradeSubmission,
  tryStartTradeSubmission,
  type TradeContext,
  type TradeOffer
} from "@/lib/data/trades";
import {
  invalidatePlayerSnapshots,
  type CollectedCard,
  type Rarity
} from "@/lib/data/cards";
import {
  groupCollection,
  pruneUnavailableSelection,
  selectGroupQuantity
} from "@/lib/ui/collection-groups";

import { createDemandPager } from "@/lib/data/demand-pages";

const rarityOrder: Record<Rarity, number> = {
  C: 0,
  R: 1,
  SR: 2,
  SSR: 3,
  LR: 4
};
const rarityText: Record<Rarity, string> = {
  C: "text-rarity-c",
  R: "text-rarity-r",
  SR: "text-rarity-sr",
  SSR: "text-rarity-ssr",
  LR: "text-rarity-lr"
};
function CardPicker({
  open,
  onClose,
  title,
  cards,
  selected,
  onChange
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  cards: CollectedCard[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [query, setQuery] = useState("");
  const [rarity, setRarity] = useState<"" | Rarity>("");
  const [sort, setSort] = useState<"rarity" | "newest" | "oldest">("rarity");
  const searchId = useId();
  const normalized = query.trim().toLocaleLowerCase("en-US");
  const groups = groupCollection(cards)
    .filter(group => {
      const card = group.representative;
      return (
        (!rarity || card.rarity === rarity) &&
        (!normalized ||
          [
            card.name,
            card.anime,
            card.category,
            card.rarity,
            card.shiny ? "shiny" : ""
          ].some(value =>
            value?.toLocaleLowerCase("en-US").includes(normalized)
          ))
      );
    })
    .sort((a, b) =>
      sort === "rarity"
        ? rarityOrder[b.representative.rarity] -
            rarityOrder[a.representative.rarity] ||
          a.representative.name.localeCompare(b.representative.name, "fr")
        : sort === "newest"
          ? Date.parse(b.firstObtainedAt) - Date.parse(a.firstObtainedAt)
          : Date.parse(a.firstObtainedAt) - Date.parse(b.firstObtainedAt)
    );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      className="yk-trade-picker-modal"
    >
      <div className="yk-trade-picker-toolbar">
        <label className="sr-only" htmlFor={searchId}>
          Search for a card to trade
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search cards or franchises…"
          className="auth-input"
        />
        <select
          aria-label="Filter by rarity"
          value={rarity}
          onChange={event => setRarity(event.target.value as "" | Rarity)}
        >
          <option value="">All rarities</option>
          {(["LR", "SSR", "SR", "R", "C"] as Rarity[]).map(value => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          aria-label="Sort cards"
          value={sort}
          onChange={event => setSort(event.target.value as typeof sort)}
        >
          <option value="rarity">Rarity</option>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>
      <p className="yk-trade-picker-note">
        Locked or listed copies aren&apos;t available for trades.
      </p>
      {groups.length ? (
        <div className="yk-trade-picker-grid">
          {groups.map(group => {
            const card = group.representative;
            const quantity = group.cards.filter(copy =>
              selected.has(copy.instanceId)
            ).length;
            return (
              <article
                key={group.key}
                className={`yk-trade-picker-card ${quantity ? "is-selected" : ""}`}
                data-group-key={group.key}
              >
                <div className="yk-trade-picker-art">
                  <YokaiCard {...card} animated={false} imageSizes="100vw" />
                  {group.cards.length > 1 && (
                    <span className="yk-trade-picker-count">
                      ×{group.cards.length}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <strong className="block truncate text-sm">
                    {card.name}
                  </strong>
                  <CardFranchise
                    card={card}
                    className="mt-1 block truncate text-xs text-ink-3"
                  />
                  <span
                    className={`mt-2 block text-xs font-bold ${rarityText[card.rarity]}`}
                  >
                    {cardRarityLabel(card.rarity, card.shiny, card.isEvolved)}
                  </span>
                </div>
                <div
                  className="yk-trade-quantity"
                  aria-label={`Number of copies of ${card.name}`}
                >
                  <button
                    type="button"
                    disabled={quantity === 0}
                    aria-label={`Remove one copy of ${card.name}`}
                    onClick={() =>
                      onChange(
                        selectGroupQuantity(selected, group.cards, quantity - 1)
                      )
                    }
                  >
                    −
                  </button>
                  <output aria-live="polite">{quantity}</output>
                  <button
                    type="button"
                    disabled={quantity === group.cards.length}
                    aria-label={`Add one copy of ${card.name}`}
                    onClick={() =>
                      onChange(
                        selectGroupQuantity(selected, group.cards, quantity + 1)
                      )
                    }
                  >
                    +
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p role="status" className="py-10 text-center text-sm text-ink-3">
          No cards match these filters.
        </p>
      )}
      <footer className="yk-trade-picker-footer">
        <span>
          {selected.size.toLocaleString("en-US")}{" "}
          {selected.size === 1 ? "copy" : "copies"} selected
        </span>
        <Button onClick={onClose}>Confirm selection</Button>
      </footer>
    </Modal>
  );
}
function OfferCards({ cards }: { cards: CollectedCard[] }) {
  return <ReviewCards cards={cards} />;
}
function ReviewCards({ cards }: { cards: CollectedCard[] }) {
  return cards.length ? (
    <div className="yk-trade-review-cards">
      {groupCollection(cards).map(group => {
        const card =
          group.cards.find(copy => copy.customImageUrl) ?? group.representative;
        return (
          <div key={group.key}>
            <div>
              <YokaiCard
                {...card}
                image={card.customImageUrl ?? card.image}
                fallbackImage={card.catalogueImage}
                animated={false}
                imageSizes="100vw"
              />
              {group.cards.length > 1 && <span>×{group.cards.length}</span>}
            </div>
            <strong>
              {card.name}
              {card.shiny || card.isEvolved
                ? ` · ${cardRarityLabel(card.rarity, card.shiny, card.isEvolved)}`
                : ""}
            </strong>
            {card.customImageUrl && <small>Custom image</small>}
          </div>
        );
      })}
    </div>
  ) : (
    <p className="mt-3 text-xs text-ink-3">No cards</p>
  );
}
function TradeSummary({
  offered,
  requested,
  offeredKaras,
  requestedKaras
}: {
  offered: CollectedCard[];
  requested: CollectedCard[];
  offeredKaras: number;
  requestedKaras: number;
}) {
  const grouped = (cards: CollectedCard[]) => groupCollection(cards);
  const hasCustom = offered.some(card => card.customImageUrl);
  const hasFolder = offered.some(card => card.folderId);
  return (
    <section className="yk-trade-summary" aria-labelledby="trade-summary-title">
      <h3 id="trade-summary-title">Review before sending</h3>
      <div>
        <article>
          <strong>You give</strong>
          {grouped(offered).length ? (
            <ul>
              {grouped(offered).map(group => (
                <li key={group.key}>
                  {group.representative.name}
                  {group.representative.shiny || group.representative.isEvolved
                    ? ` · ${cardRarityLabel(group.representative.rarity, group.representative.shiny, group.representative.isEvolved)}`
                    : ""}
                  {group.cards.length > 1 ? ` ×${group.cards.length}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p>No cards</p>
          )}
          <Karas amount={offeredKaras} />
          {offered.length > 0 && (
            <details>
              <summary>Specific copies ({offered.length})</summary>
              <ul>
                {offered.map(card => (
                  <li key={card.instanceId}>
                    <code>{card.instanceId}</code>
                    {card.customImageUrl ? "· custom image" : ""}
                    {card.folderId ? "· stored in a folder" : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </article>
        <article>
          <strong>You receive</strong>
          {grouped(requested).length ? (
            <ul>
              {grouped(requested).map(group => (
                <li key={group.key}>
                  {group.representative.name}
                  {group.representative.shiny || group.representative.isEvolved
                    ? ` · ${cardRarityLabel(group.representative.rarity, group.representative.shiny, group.representative.isEvolved)}`
                    : ""}
                  {group.cards.length > 1 ? ` ×${group.cards.length}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p>No cards</p>
          )}
          <Karas amount={requestedKaras} />
        </article>
      </div>
      {(hasCustom || hasFolder) && (
        <ul className="yk-trade-summary-warnings">
          {hasCustom && (
            <li>
              The custom image will be kept and visible to the recipient after
              the transfer.
            </li>
          )}
          {hasFolder && (
            <li>
              The card will be removed from its folder during the transfer.
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

type TradeTab = "compose" | "received" | "sent" | "history";

function OfferList({
  offers,
  busy,
  onReview,
  onCancel
}: {
  offers: TradeOffer[];
  busy?: boolean;
  onReview?: (offer: TradeOffer) => void;
  onCancel?: (offer: TradeOffer) => void;
}) {
  if (!offers.length)
    return (
      <div className="yk-social-empty">
        <span className="yk-social-empty-icon" aria-hidden="true">
          ⇄
        </span>
        <strong>No trade offers</strong>
        <p>Trade offers for this tab will appear here.</p>
      </div>
    );
  return (
    <div className="yk-trade-history">
      {offers.map(offer => (
        <article key={offer.id} className="yk-trade-offer">
          <header>
            <Avatar
              name={offer.incoming ? offer.fromPseudo : offer.toPseudo}
              image={
                (offer.incoming ? offer.fromAvatarUrl : offer.toAvatarUrl) ??
                undefined
              }
              size={36}
            />
            <div>
              <strong>
                {offer.incoming ? offer.fromPseudo : offer.toPseudo}
              </strong>
              <p>
                {offer.incoming ? "Offer received" : "Offer sent"} ·{" "}
                {new Date(offer.createdAt).toLocaleString("en-US")}
              </p>
            </div>
            <StatusPill tone={tradeStatusPresentation(offer.status).tone}>
              {tradeStatusPresentation(offer.status).label}
            </StatusPill>
          </header>
          <div className="yk-trade-offer-sides">
            <div>
              <p>{offer.fromPseudo} gives</p>
              <OfferCards cards={offer.offeredCards} />
              {offer.offeredKaras > 0 && <Karas amount={offer.offeredKaras} />}
            </div>
            <div>
              <p>{offer.toPseudo} gives</p>
              <OfferCards cards={offer.requestedCards} />
              {offer.requestedKaras > 0 && (
                <Karas amount={offer.requestedKaras} />
              )}
            </div>
          </div>
          {(onReview || onCancel) && (
            <footer>
              {onReview && (
                <Button onClick={() => onReview(offer)}>Review trade</Button>
              )}
              {onCancel && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onCancel(offer)}
                >
                  Cancel offer
                </Button>
              )}
            </footer>
          )}
        </article>
      ))}
    </div>
  );
}

function TradeReview({
  offer,
  busy,
  onAccept,
  onDecline,
  onCounter,
  onCancel,
  onClose
}: {
  offer?: TradeOffer;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onCounter: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const presentation = tradeStatusPresentation(offer?.status);
  const actionable = offer?.incoming && offer.status === "pending";
  const cancellable = offer && !offer.incoming && offer.status === "pending";
  return (
    <section className="yk-trade-review">
      <header>
        <p className="eyebrow">
          {offer
            ? `Trade with ${offer.incoming ? offer.fromPseudo : offer.toPseudo}`
            : "Offre introuvable"}
        </p>
        <StatusPill tone={presentation.tone}>{presentation.label}</StatusPill>
      </header>
      {offer ? (
        <>
          <p className="mt-4 text-sm text-ink-2">
            {offer.status === "accepted"
              ? "This trade was accepted. Here's what was exchanged."
              : offer.status === "declined"
                ? "This offer was declined."
                : offer.status === "countered"
                  ? "A counteroffer replaced this offer."
                  : offer.status === "cancelled"
                    ? "This offer was canceled."
                    : offer.status === "pending"
                      ? "Review both sides before responding."
                      : "This offer is no longer available."}
          </p>
          <div className="yk-trade-review-lots">
            <article>
              <h3>What you receive</h3>
              <ReviewCards
                cards={
                  offer.incoming ? offer.offeredCards : offer.requestedCards
                }
              />
              <Karas
                amount={
                  offer.incoming ? offer.offeredKaras : offer.requestedKaras
                }
              />
            </article>
            <article>
              <h3>What you give</h3>
              <ReviewCards
                cards={
                  offer.incoming ? offer.requestedCards : offer.offeredCards
                }
              />
              <Karas
                amount={
                  offer.incoming ? offer.requestedKaras : offer.offeredKaras
                }
              />
            </article>
          </div>
        </>
      ) : (
        <p className="mt-4 text-sm text-ink-2">
          This offer couldn&apos;t be found or is no longer available.
        </p>
      )}
      <footer>
        {actionable && (
          <>
            <Button disabled={busy} onClick={onAccept}>
              Accept
            </Button>
            <Button variant="secondary" disabled={busy} onClick={onCounter}>
              Counteroffer
            </Button>
            <Button variant="secondary" disabled={busy} onClick={onDecline}>
              Decline
            </Button>
          </>
        )}
        {cancellable && (
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            Cancel offer
          </Button>
        )}
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </footer>
    </section>
  );
}

export type TradesPanelAdapter = {
  friendships: typeof getFriendships;
  listOffers: typeof listTradeOffers;
  context: typeof getTradeContext;
  create: typeof createTradeOffer;
  cancel: typeof cancelTradeOffer;
  respond: typeof respondTradeOffer;
};
const defaultAdapter: TradesPanelAdapter = {
  friendships: getFriendships,
  listOffers: listTradeOffers,
  context: getTradeContext,
  create: createTradeOffer,
  cancel: cancelTradeOffer,
  respond: respondTradeOffer
};
// #388: offers are not a live chat; actions and accepted-trade invalidations
// cover the rest.
export const TRADE_POLL_INTERVAL_MS = 30_000;
export function TradesPanel({
  adapter = defaultAdapter,
  pollIntervalMs = TRADE_POLL_INTERVAL_MS,
  initialFriendId: requestedInitialFriendId,
  fixedFriendId,
  initialRequestedCardId,
  initialOfferId,
  onOfferSent
}: {
  adapter?: TradesPanelAdapter;
  pollIntervalMs?: number | null;
  initialFriendId?: string;
  fixedFriendId?: string;
  initialRequestedCardId?: string;
  initialOfferId?: string;
  onOfferSent?: () => void;
} = {}) {
  const initialFriendId = fixedFriendId ?? requestedInitialFriendId;
  const offerPager = useMemo(
    () =>
      createDemandPager(
        adapter === defaultAdapter
          ? listTradeOffersPage
          : async () => ({
              items: await adapter.listOffers(),
              nextCursor: null
            }),
        offer => offer.id
      ),
    [adapter]
  );
  const friendPager = useMemo(
    () =>
      createDemandPager(
        adapter === defaultAdapter
          ? getFriendshipsPage
          : async () => ({
              items: friendshipItems(await adapter.friendships()),
              nextCursor: null
            }),
        item => item.friend.requestId ?? item.friend.id
      ),
    [adapter]
  );
  const [hasMoreOffers, setHasMoreOffers] = useState(false);
  const [hasMoreFriends, setHasMoreFriends] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  async function readOffers(more = false) {
    const page = await (more ? offerPager.more() : offerPager.refresh());
    setHasMoreOffers(!!page.nextCursor);
    return page.items;
  }
  async function readFriends(more = false) {
    const page = await (more ? friendPager.more() : friendPager.refresh());
    setHasMoreFriends(!!page.nextCursor);
    return groupFriendships(page.items);
  }
  async function loadMore(kind: "friends" | "offers") {
    setLoadingMore(true);
    setError("");
    try {
      if (kind === "friends") setFriends((await readFriends(true)).friends);
      else {
        const next = await readOffers(true);
        offersRef.current = next;
        setOffers(next);
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't load more. Please try again."
      );
    } finally {
      setLoadingMore(false);
    }
  }
  const [friends, setFriends] = useState<FriendUser[]>([]);
  const [friendQuery, setFriendQuery] = useState("");
  const visibleFriends = friends.filter(friend =>
    friend.pseudo
      .toLocaleLowerCase("en-US")
      .includes(friendQuery.trim().toLocaleLowerCase("en-US"))
  );
  const [offers, setOffers] = useState<TradeOffer[]>([]);
  const [tab, setTab] = useState<TradeTab>("compose");
  const [context, setContext] = useState<TradeContext>();
  const [friendId, setFriendId] = useState("");
  const [offered, setOffered] = useState<Set<string>>(new Set());
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState<"offered" | "requested">();
  const [selectionNotice, setSelectionNotice] = useState("");
  const [sentNotice, setSentNotice] = useState("");
  const [offeredKaras, setOfferedKaras] = useState("0");
  const [requestedKaras, setRequestedKaras] = useState("0");
  const [parent, setParent] = useState<string | null>(null);
  const [pendingFriend, setPendingFriend] = useState<{
    id: string;
    parentId: string | null;
  }>();
  const [pendingCounter, setPendingCounter] = useState<TradeOffer>();
  const [reviewedId, setReviewedId] = useState<string | undefined>(
    fixedFriendId ? undefined : initialOfferId
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accepting, setAccepting] = useState<TradeOffer>();
  const [cancelling, setCancelling] = useState<TradeOffer>();
  const offersRef = useRef<TradeOffer[]>([]);
  const friendIdRef = useRef("");
  const contextRequest = useRef(0);
  const offeredRef = useRef(offered);
  const requestedRef = useRef(requested);
  const submissionLock = useRef(false);
  const cancellationLock = useRef(false);
  function updateOffered(next: Set<string>) {
    offeredRef.current = next;
    setOffered(next);
  }
  function updateRequested(next: Set<string>) {
    requestedRef.current = next;
    setRequested(next);
  }
  async function reload() {
    const [relations, history] = await Promise.all([
      readFriends(),
      readOffers()
    ]);
    offersRef.current = history;
    setFriends(relations.friends);
    setOffers(history);
  }
  useEffect(() => {
    let active = true;
    let loading = true;
    void Promise.all([friendPager.refresh(), offerPager.refresh()])
      .then(
        ([relationsPage, offersPage]) => {
          const relations = groupFriendships(relationsPage.items);
          const history = offersPage.items;
          if (active) {
            setHasMoreFriends(!!relationsPage.nextCursor);
            setHasMoreOffers(!!offersPage.nextCursor);
            offersRef.current = history;
            setFriends(relations.friends);
            setOffers(history);
          }
        },
        e => {
          if (active)
            setError(e instanceof Error ? e.message : "Couldn't load trades.");
        }
      )
      .finally(() => {
        loading = false;
      });
    const refresh = async () => {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      try {
        const page = await offerPager.refresh();
        if (!active) return;
        const history = page.items;
        setHasMoreOffers(!!page.nextCursor);
        const accepted = hasNewAcceptedTrade(offersRef.current, history);
        offersRef.current = history;
        setOffers(history);
        setAccepting(current =>
          current && tradeOfferIsActionable(current.id, history)
            ? history.find(offer => offer.id === current.id)
            : undefined
        );
        if (accepted) invalidatePlayerSnapshots(["collection", "balance"]);
        const selectedFriend = friendIdRef.current;
        if (selectedFriend) {
          const request = ++contextRequest.current;
          const nextContext = await loadTradeContextIfCurrent(
            adapter.context,
            selectedFriend,
            request,
            () => ({
              friendId: friendIdRef.current,
              requestId: contextRequest.current
            })
          );
          if (active && nextContext) {
            const nextOffered = pruneUnavailableSelection(
              offeredRef.current,
              nextContext.ownCards
            );
            const nextRequested = pruneUnavailableSelection(
              requestedRef.current,
              nextContext.friendCards
            );
            const removed =
              nextOffered.removed.length + nextRequested.removed.length;
            if (nextOffered.removed.length) {
              offeredRef.current = nextOffered.selected;
              setOffered(nextOffered.selected);
            }
            if (nextRequested.removed.length) {
              requestedRef.current = nextRequested.selected;
              setRequested(nextRequested.selected);
            }
            if (removed)
              setSelectionNotice(
                `${removed.toLocaleString("en-US")} selected ${removed === 1 ? "card is" : "cards are"} no longer available and ${removed === 1 ? "has" : "have"} been removed.`
              );
            setContext(nextContext);
          }
        }
      } catch (reason) {
        if (process.env.NODE_ENV !== "production")
          console.error("[trades] automatic refresh failed", reason);
      } finally {
        loading = false;
      }
    };
    const stop = pollIntervalMs
      ? startVisiblePolling(() => void refresh(), pollIntervalMs)
      : undefined;
    return () => {
      active = false;
      stop?.();
    };
  }, [adapter, pollIntervalMs, offerPager, friendPager]);
  useEffect(() => {
    if (!initialOfferId) return;
    let active = true;
    void (async () => {
      let page = await offerPager.refresh();
      while (
        !page.items.some(offer => offer.id === initialOfferId) &&
        page.nextCursor &&
        active
      )
        page = await offerPager.more();
      if (active) {
        offersRef.current = page.items;
        setOffers(page.items);
        setHasMoreOffers(!!page.nextCursor);
      }
    })().catch(e => {
      if (active)
        setError(e instanceof Error ? e.message : "Couldn't load this offer.");
    });
    return () => {
      active = false;
    };
  }, [initialOfferId, offerPager]);
  async function chooseFriend(
    id: string,
    parentId: string | null = null,
    requestedCardId?: string
  ) {
    if (fixedFriendId && id !== fixedFriendId) return;
    friendIdRef.current = id;
    setFriendId(id);
    setParent(parentId);
    updateRequested(new Set());
    setContext(undefined);
    setSelectionNotice("");
    setError("");
    const request = ++contextRequest.current;
    try {
      const nextContext = await loadTradeContextIfCurrent(
        adapter.context,
        id,
        request,
        () => ({
          friendId: friendIdRef.current,
          requestId: contextRequest.current
        })
      );
      if (nextContext) {
        setContext(nextContext);
        if (requestedCardId) {
          if (
            nextContext.friendCards.some(
              card => card.instanceId === requestedCardId
            )
          )
            updateRequested(new Set([requestedCardId]));
          else setError("This card is no longer available to trade.");
        }
      }
    } catch (e) {
      if (friendIdRef.current === id && contextRequest.current === request)
        setError(e instanceof Error ? e.message : "Couldn't load trades.");
    }
  }
  function requestFriendChange(id: string, parentId: string | null = null) {
    if (fixedFriendId && id !== fixedFriendId) return;
    if (id === friendId && parentId === parent) return;
    if (requested.size) {
      setPendingFriend({ id, parentId });
      return;
    }
    void chooseFriend(id, parentId);
  }
  async function composeCounter(offer: TradeOffer) {
    if (fixedFriendId && offer.fromUser !== fixedFriendId) return;
    if (
      !offer.fromUser ||
      !tradeOfferIsActionable(offer.id, offersRef.current)
    ) {
      setError("This offer is no longer pending.");
      return;
    }
    setBusy(true);
    setError("");
    const previousFriend = friendIdRef.current;
    friendIdRef.current = "";
    const request = ++contextRequest.current;
    try {
      const nextContext = await adapter.context(offer.fromUser);
      if (contextRequest.current !== request) return;
      if (
        !offer.fromUser ||
        !tradeOfferIsActionable(offer.id, offersRef.current)
      ) {
        friendIdRef.current = previousFriend;
        setError("This offer is no longer pending.");
        return;
      }
      const draft = counterTradeDraft(offer, nextContext);
      friendIdRef.current = offer.fromUser;
      setFriendId(offer.fromUser);
      setParent(offer.id);
      setContext(nextContext);
      updateOffered(draft.offered);
      updateRequested(draft.requested);
      setOfferedKaras(draft.offeredKaras);
      setRequestedKaras(draft.requestedKaras);
      setSelectionNotice(
        draft.removed
          ? `${draft.removed.toLocaleString("en-US")} ${draft.removed === 1 ? "card" : "cards"} from the original offer ${draft.removed === 1 ? "is" : "are"} no longer available.`
          : ""
      );
      setReviewedId(undefined);
      setTab("compose");
    } catch (e) {
      if (contextRequest.current === request) {
        friendIdRef.current = previousFriend;
        setError(
          e instanceof Error ? e.message : "Couldn't prepare the counteroffer."
        );
      }
    } finally {
      setBusy(false);
    }
  }
  function requestCounter(offer: TradeOffer) {
    if (friendId || hasContent) {
      setPendingCounter(offer);
      return;
    }
    void composeCounter(offer);
  }
  useEffect(() => {
    if (!initialFriendId) return;
    let active = true;
    void friendPager
      .refresh()
      .then(async firstPage => {
        if (!active) return;
        const relations = groupFriendships(firstPage.items);
        const normalized = initialFriendId.toLocaleLowerCase("en-US");
        let friend = relations.friends.find(
          item =>
            item.id === initialFriendId ||
            item.pseudo.toLocaleLowerCase("en-US") === normalized
        );
        let page = firstPage;
        while (!friend && page.nextCursor && active) {
          page = await friendPager.more();
          const next = groupFriendships(page.items);
          setFriends(next.friends);
          setHasMoreFriends(!!page.nextCursor);
          friend = next.friends.find(
            item =>
              item.id === initialFriendId ||
              item.pseudo.toLocaleLowerCase("en-US") === normalized
          );
        }
        if (!friend) {
          setError("This player isn't available to trade.");
          return;
        }
        friendIdRef.current = friend.id;
        setFriendId(friend.id);
        setParent(null);
        setRequested(new Set());
        setContext(undefined);
        setError("");
        const request = ++contextRequest.current;
        const nextContext = await loadTradeContextIfCurrent(
          adapter.context,
          friend.id,
          request,
          () => ({
            friendId: friendIdRef.current,
            requestId: contextRequest.current
          })
        );
        if (!active || !nextContext) return;
        setContext(nextContext);
        if (initialRequestedCardId) {
          if (
            nextContext.friendCards.some(
              card => card.instanceId === initialRequestedCardId
            )
          )
            setRequested(new Set([initialRequestedCardId]));
          else setError("This card is no longer available to trade.");
        }
      })
      .catch(reason => {
        if (active)
          setError(
            reason instanceof Error ? reason.message : "Couldn't load trades."
          );
      });
    return () => {
      active = false;
    };
  }, [adapter, friendPager, initialFriendId, initialRequestedCardId]);
  async function submit() {
    if (fixedFriendId && context?.friend.id !== fixedFriendId) return;
    if (!context || !tryStartTradeSubmission(submissionLock, hasContent))
      return;
    setBusy(true);
    setError("");
    setSentNotice("");
    try {
      await adapter.create(
        tradeSubmission({
          friendId: context.friend.id,
          offered,
          offeredKaras,
          requested,
          requestedKaras,
          parent
        })
      );
      await reload();
      updateOffered(new Set());
      updateRequested(new Set());
      setOfferedKaras("0");
      setRequestedKaras("0");
      setPicker(undefined);
      setSelectionNotice("");
      setContext(undefined);
      friendIdRef.current = "";
      contextRequest.current++;
      setFriendId("");
      setParent(null);
      setSentNotice("Offer sent. You can now find it in this tab.");
      setTab("sent");
      if (fixedFriendId) await chooseFriend(fixedFriendId);
      onOfferSent?.();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Couldn't send this offer. Please try again."
      );
    } finally {
      submissionLock.current = false;
      setBusy(false);
    }
  }
  async function respond(id: string, action: "accept" | "decline") {
    setBusy(true);
    setError("");
    try {
      await adapter.respond(id, action);
      setAccepting(undefined);
      await reload();
    } catch (e) {
      setAccepting(undefined);
      setError(
        e instanceof Error ? e.message : "Couldn't complete this action."
      );
      try {
        await reload();
      } catch {}
    } finally {
      setBusy(false);
    }
  }
  async function cancel(id: string) {
    if (cancellationLock.current) return;
    setBusy(true);
    setError("");
    try {
      await runTradeCancellation(cancellationLock, adapter.cancel, id);
      setCancelling(undefined);
      await reload();
    } catch (e) {
      setCancelling(undefined);
      setError(e instanceof Error ? e.message : "Couldn't cancel this offer.");
      try {
        await reload();
      } catch {}
    } finally {
      cancellationLock.current = false;
      setBusy(false);
    }
  }
  const scopedOffers = fixedFriendId
    ? offers.filter(
        offer =>
          offer.fromUser === fixedFriendId || offer.toUser === fixedFriendId
      )
    : offers;
  const received = filterTradeOffers(scopedOffers, "received");
  const sent = filterTradeOffers(scopedOffers, "sent");
  const history = filterTradeOffers(scopedOffers, "history");
  const hasContent =
    offered.size > 0 ||
    requested.size > 0 ||
    Number(offeredKaras) > 0 ||
    Number(requestedKaras) > 0;
  const insufficient = !!context && Number(offeredKaras) > context.balance;
  const reviewedOffer = resolveTradeReview(reviewedId, offers);
  return (
    <div className="yk-social-stack" data-fixed-trade-friend={fixedFriendId}>
      <section className="yk-social-panel">
        <Tabs
          label="Trade navigation"
          value={tab}
          onChange={value => setTab(value as TradeTab)}
          items={[
            { id: "compose", label: "Proposer" },
            {
              id: "received",
              label: `Received · ${received.length.toLocaleString("en-US")}${hasMoreOffers ? "+" : ""}`
            },
            {
              id: "sent",
              label: `Sent · ${sent.length.toLocaleString("en-US")}${hasMoreOffers ? "+" : ""}`
            },
            { id: "history", label: "History" }
          ]}
        />
        {tab === "compose" && (
          <div role="tabpanel" aria-label="Offer a trade">
            <div className="yk-trade-heading mt-6">
              <div>
                <p className="eyebrow">New offer</p>
                <h2 className="yk-section-title mt-2">
                  {fixedFriendId ? "Your trade" : "Choose a friend"}
                </h2>
              </div>
              {context && (
                <StatusPill tone="info">
                  Trade with {context.friend.pseudo}
                </StatusPill>
              )}
            </div>
            {!fixedFriendId && (
              <input
                type="search"
                aria-label="Rechercher un ami"
                placeholder="Rechercher un ami…"
                className="auth-input mt-4"
                value={friendQuery}
                onChange={event => setFriendQuery(event.target.value)}
              />
            )}
            {!fixedFriendId && friendQuery.trim() && !visibleFriends.length && (
              <p role="status" className="mt-4 text-sm text-ink-2">
                Aucun ami correspondant parmi les amis chargés.
              </p>
            )}
            {!fixedFriendId && (
              <div className="yk-friend-choices">
                {visibleFriends.map(friend => (
                  <Chip
                    key={friend.id}
                    active={friendId === friend.id}
                    className="min-h-11 pl-1.5 pr-4"
                    onClick={() => requestFriendChange(friend.id)}
                  >
                    <Avatar
                      name={friend.pseudo}
                      image={friend.avatarUrl ?? undefined}
                      online
                      size={30}
                    />
                    {friend.pseudo}
                  </Chip>
                ))}
              </div>
            )}
            {!fixedFriendId && hasMoreFriends && (
              <Button
                variant="secondary"
                disabled={loadingMore}
                onClick={() => void loadMore("friends")}
              >
                {loadingMore ? "Loading…" : "Load more friends"}
              </Button>
            )}
            {!fixedFriendId && !!friends.length && !hasMoreFriends && (
              <p role="status" className="sr-only">
                All friends loaded.
              </p>
            )}
            {!friends.length && (
              <div className="yk-social-empty is-compact">
                <strong>No friends available</strong>
                <span>Add a friend from the Friends page first.</span>
              </div>
            )}
            {context && (
              <div className="yk-trade-composer">
                <div className="yk-trade-columns">
                  <section className="yk-trade-side is-offered">
                    <header>
                      <span className="yk-trade-side-index">01</span>
                      <div>
                        <p>You give</p>
                        <small>
                          Your collection ·{" "}
                          {offered.size.toLocaleString("en-US")} selected
                        </small>
                      </div>
                    </header>
                    <div
                      className="yk-trade-drop"
                      data-instance-ids={[...offered].join(",")}
                    >
                      <OfferCards
                        cards={context.ownCards.filter(card =>
                          offered.has(card.instanceId)
                        )}
                      />
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() => setPicker("offered")}
                    >
                      Add cards from my collection
                    </Button>
                    <label className="yk-trade-karas">
                      Karas to offer <Karas amount={context.balance} />
                      <input
                        type="number"
                        min="0"
                        max={context.balance}
                        aria-invalid={insufficient}
                        value={offeredKaras}
                        onChange={e => setOfferedKaras(e.target.value)}
                        className="auth-input"
                      />
                    </label>
                    {insufficient && (
                      <p role="alert" className="yk-inline-error">
                        Not enough Karas (your balance:{" "}
                        {context.balance.toLocaleString("en-US")} K)
                      </p>
                    )}
                  </section>
                  <section className="yk-trade-side is-requested">
                    <header>
                      <span className="yk-trade-side-index">02</span>
                      <div>
                        <p>You receive</p>
                        <small>
                          Collection of {context.friend.pseudo} ·{" "}
                          {requested.size.toLocaleString("en-US")} selected
                        </small>
                      </div>
                    </header>
                    <div
                      className="yk-trade-drop"
                      data-instance-ids={[...requested].join(",")}
                    >
                      <OfferCards
                        cards={context.friendCards.filter(card =>
                          requested.has(card.instanceId)
                        )}
                      />
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() => setPicker("requested")}
                    >
                      Browse cards from {context.friend.pseudo}
                    </Button>
                    <label className="yk-trade-karas">
                      Karas to request
                      <input
                        type="number"
                        min="0"
                        value={requestedKaras}
                        onChange={e => setRequestedKaras(e.target.value)}
                        className="auth-input"
                      />
                    </label>
                  </section>
                </div>
                {selectionNotice && (
                  <p role="alert" className="yk-social-alert mt-5">
                    {selectionNotice}
                  </p>
                )}
                <TradeSummary
                  offered={context.ownCards.filter(card =>
                    offered.has(card.instanceId)
                  )}
                  requested={context.friendCards.filter(card =>
                    requested.has(card.instanceId)
                  )}
                  offeredKaras={Number(offeredKaras) || 0}
                  requestedKaras={Number(requestedKaras) || 0}
                />
                <footer className="yk-trade-submit">
                  <p>
                    Card ownership will be checked again when the trade is
                    accepted.
                  </p>
                  <Button
                    aria-busy={busy || undefined}
                    disabled={busy || !hasContent || insufficient}
                    onClick={() => void submit()}
                  >
                    {busy
                      ? "Sending…"
                      : parent
                        ? "Send counteroffer"
                        : "Send offer"}
                  </Button>
                </footer>
              </div>
            )}
          </div>
        )}
        {tab !== "compose" && (
          <div
            role="tabpanel"
            aria-label={
              tab === "received"
                ? "Received offers"
                : tab === "sent"
                  ? "Sent offers"
                  : "Trade history"
            }
          >
            {tab === "sent" && sentNotice && (
              <Feedback tone="success" title="Offer sent">
                {sentNotice}
              </Feedback>
            )}
            <div className="yk-trade-history-head mt-6">
              <div>
                <p className="eyebrow">
                  {tab === "history" ? "History" : "Active"}
                </p>
                <h2 className="yk-section-title mt-2">
                  {tab === "received"
                    ? "Received offers"
                    : tab === "sent"
                      ? "Sent offers"
                      : "Completed trades"}
                </h2>
              </div>
            </div>
            <OfferList
              offers={
                tab === "received" ? received : tab === "sent" ? sent : history
              }
              busy={busy}
              onReview={offer => setReviewedId(offer.id)}
              onCancel={tab === "sent" ? setCancelling : undefined}
            />
            {hasMoreOffers && (
              <Button
                variant="secondary"
                disabled={loadingMore}
                onClick={() => void loadMore("offers")}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            )}
            {!hasMoreOffers && (
              <p role="status" className="sr-only">
                All offers loaded.
              </p>
            )}
          </div>
        )}
      </section>
      {error && (
        <p role="alert" className="yk-social-alert">
          {error}
        </p>
      )}
      <Modal
        open={!!reviewedId}
        onClose={() => setReviewedId(undefined)}
        title="Review trade"
        className="yk-trade-review-modal"
      >
        <TradeReview
          offer={reviewedOffer}
          busy={busy}
          onClose={() => setReviewedId(undefined)}
          onAccept={() => reviewedOffer && setAccepting(reviewedOffer)}
          onDecline={() =>
            reviewedOffer && void respond(reviewedOffer.id, "decline")
          }
          onCounter={() => reviewedOffer && requestCounter(reviewedOffer)}
          onCancel={() => reviewedOffer && setCancelling(reviewedOffer)}
        />
        {error && (
          <p role="alert" className="yk-social-alert mt-4">
            {error}
          </p>
        )}
      </Modal>
      {context && (
        <>
          <CardPicker
            open={picker === "offered"}
            onClose={() => setPicker(undefined)}
            title="Choose from your collection"
            cards={context.ownCards}
            selected={offered}
            onChange={updateOffered}
          />
          <CardPicker
            open={picker === "requested"}
            onClose={() => setPicker(undefined)}
            title={`Choose from ${context.friend.pseudo}'s collection`}
            cards={context.friendCards}
            selected={requested}
            onChange={updateRequested}
          />
        </>
      )}
      <Modal
        open={!!pendingFriend}
        onClose={() => setPendingFriend(undefined)}
        title="Change friend?"
        className="max-w-lg"
      >
        <p className="text-sm leading-6 text-ink-2">
          The requested cards belong to your current friend. Changing friends
          will clear only that selection. Your offered cards and entered Karas
          amounts will be kept.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="secondary"
            onClick={() => setPendingFriend(undefined)}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              const next = pendingFriend;
              setPendingFriend(undefined);
              if (next) void chooseFriend(next.id, next.parentId);
            }}
          >
            Change friend
          </Button>
        </div>
      </Modal>
      <Modal
        open={!!pendingCounter}
        onClose={() => setPendingCounter(undefined)}
        title="Replace draft?"
        className="max-w-lg"
      >
        <p className="text-sm leading-6 text-ink-2">
          Preparing this counteroffer will replace the friend, cards, and Karas
          in your current draft.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="secondary"
            onClick={() => setPendingCounter(undefined)}
          >
            Keep my draft
          </Button>
          <Button
            onClick={() => {
              const offer = pendingCounter;
              setPendingCounter(undefined);
              if (offer) void composeCounter(offer);
            }}
          >
            Replace and continue
          </Button>
        </div>
      </Modal>
      <Modal
        open={!!accepting}
        onClose={() => setAccepting(undefined)}
        title="This can't be undone"
        className="max-w-lg"
      >
        <p className="text-sm leading-6 text-ink-2">
          Accepting will transfer the cards and Karas in this offer immediately.
          Check its contents one last time.
        </p>
        {accepting && (
          <div className="yk-trade-confirm">
            <div>
              <strong>You receive</strong>
              <OfferCards cards={accepting.offeredCards} />
              {accepting.offeredKaras > 0 && (
                <Karas amount={accepting.offeredKaras} />
              )}
            </div>
            <div>
              <strong>You give</strong>
              <OfferCards cards={accepting.requestedCards} />
              {accepting.requestedKaras > 0 && (
                <Karas amount={accepting.requestedKaras} />
              )}
            </div>
          </div>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setAccepting(undefined)}>
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={() => accepting && void respond(accepting.id, "accept")}
          >
            {busy ? "Accepting…" : "Confirm trade"}
          </Button>
        </div>
      </Modal>
      <Modal
        open={!!cancelling}
        onClose={() => setCancelling(undefined)}
        title="Cancel this offer?"
        className="max-w-lg"
      >
        <p className="text-sm leading-6 text-ink-2">
          This offer will be removed from pending offers.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setCancelling(undefined)}
          >
            Keep offer
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() => cancelling && void cancel(cancelling.id)}
          >
            {busy ? "Canceling…" : "Cancel offer"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
