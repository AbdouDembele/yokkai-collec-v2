"use client";
import { gameErrorKey } from "@/i18n/game-messages";
import { useTranslations } from "next-intl";

import { useCallback, useEffect, useRef, useState } from "react";
import { AuctionView, presentAuction } from "@/components/community-views";
import { Button, Karas, Modal } from "@/components/ui";
import { YokaiCard } from "@/components/yokai-card";
import {
  liveProfileMarket,
  type ProfileMarketAdapter,
  type ProfileAuctionPage
} from "@/lib/data/profile-market";
import type { AuctionData, AuctionDetail } from "@/lib/data/market";

function ProfileAuction({
  id,
  ownerId,
  adapter,
  onUpdate,
  onClose
}: {
  id: string;
  ownerId: string;
  adapter: ProfileMarketAdapter;
  onUpdate: (auction: AuctionData) => void;
  onClose: () => void;
}) {
  const t = useTranslations();
  const [auction, setAuction] = useState<AuctionDetail>();
  const [viewer, setViewer] = useState<string>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [, setClock] = useState(0);
  const lock = useRef(false);
  const mounted = useRef(false);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const ticket = revision.current;
    const [next, currentViewer] = await Promise.all([
      adapter.get(id),
      adapter.viewer()
    ]);
    if (next.sellerId !== ownerId)
      throw new Error("This listing no longer belongs to this profile.");
    if (mounted.current && ticket === revision.current) {
      setAuction(next);
      setViewer(currentViewer);
      setError("");
      onUpdate(next);
    }
  }, [adapter, id, ownerId, onUpdate]);
  useEffect(() => {
    mounted.current = true;
    revision.current++;
    let loading = false;
    const load = async () => {
      if (loading || lock.current || document.visibilityState !== "visible")
        return;
      loading = true;
      try {
        await refresh();
      } catch (reason) {
        if (mounted.current)
          setError(
            reason instanceof Error ? reason.message : "Auction unavailable."
          );
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = window.setInterval(() => {
      setClock(value => value + 1);
      void load();
    }, 3000);
    const visible = () => void load();
    document.addEventListener("visibilitychange", visible);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);
  const mutate = async (action: () => Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true;
    revision.current++;
    setBusy(true);
    try {
      await action();
      try {
        await refresh();
      } catch {
        // A successful write must never be presented as a failed bid (and retried).
        if (mounted.current)
          setError(
            "Action saved. Refresh the auction to see its latest status."
          );
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const presentation =
    auction && viewer ? presentAuction(auction, viewer) : undefined;
  return (
    <Modal
      open
      onClose={() => {
        if (!lock.current) onClose();
      }}
      title={t("profileUi.auctionDetails")}
      className="yk-profile-auction-modal"
    >
      {error && (
        <div className="yk-profile-auction-error">
          <p role="alert">
            {t(gameErrorKey(error, "profileUi.profileUnavailable"))}
          </p>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void refresh().catch(() =>
                setError("Couldn't refresh this auction.")
              )
            }
          >
            {t("profileUi.refresh")}{" "}
          </Button>
        </div>
      )}
      {!auction && !error && (
        <p role="status">{t("profileUi.loadingAuction")}</p>
      )}
      {presentation && (
        <AuctionView
          auction={presentation}
          chatAdapter={adapter.chat}
          onBid={
            !error && !busy && viewer !== ownerId && !presentation.finished
              ? amount => mutate(() => adapter.bid(id, amount))
              : undefined
          }
          onCancel={
            !error && !busy && viewer === ownerId && !presentation.finished
              ? () => mutate(() => adapter.cancel(id))
              : undefined
          }
          onToggleWatch={
            !error && !busy
              ? async () => {
                  try {
                    await mutate(() => adapter.watch(id));
                  } catch (reason) {
                    setError(
                      reason instanceof Error
                        ? reason.message
                        : "Couldn't update your watchlist."
                    );
                  }
                }
              : undefined
          }
        />
      )}
    </Modal>
  );
}

export function ProfileSales({
  ownerId,
  adapter = liveProfileMarket
}: {
  ownerId: string;
  adapter?: ProfileMarketAdapter;
}) {
  const t = useTranslations();
  const [page, setPage] = useState<ProfileAuctionPage>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [now, setNow] = useState(0);
  const mounted = useRef(false);
  const loading = useRef(false);
  const load = useCallback(
    async (cursor: ProfileAuctionPage["nextCursor"] = null) => {
      if (loading.current) return;
      loading.current = true;
      setBusy(true);
      try {
        const next = await adapter.list(ownerId, cursor);
        if (mounted.current) {
          setPage(current =>
            cursor
              ? {
                  ...next,
                  items: [
                    ...new Map(
                      [...(current?.items ?? []), ...next.items].map(item => [
                        item.id,
                        item
                      ])
                    ).values()
                  ]
                }
              : next
          );
          setError("");
          setNow(Date.now());
        }
      } catch (reason) {
        if (mounted.current)
          setError(
            reason instanceof Error ? reason.message : "Listings unavailable."
          );
      } finally {
        loading.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [ownerId, adapter]
  );
  useEffect(() => {
    mounted.current = true;
    void Promise.resolve().then(() => {
      if (mounted.current) void load();
    });
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
    };
  }, [load]);
  const update = useCallback(
    (auction: AuctionData) =>
      setPage(
        current =>
          current && {
            ...current,
            items: current.items.map(item =>
              item.id === auction.id ? auction : item
            )
          }
      ),
    []
  );
  const active =
    page?.items.filter(
      item =>
        item.sellerId === ownerId &&
        item.status === "active" &&
        Date.parse(item.endsAt) > now
    ) ?? [];
  return (
    <section
      className="yk-profile-sales"
      aria-label={t("profileUi.activeListings")}
    >
      <div className="yk-profile-section-heading">
        <div>
          <p className="eyebrow">{t("profileUi.onTheMarket")}</p>
          <h2>{t("profileUi.activeListings")}</h2>
        </div>
        <Button variant="secondary" disabled={busy} onClick={() => void load()}>
          {t("profileUi.refreshListings")}{" "}
        </Button>
      </div>
      {error && (
        <p role="alert" className="yk-profile-notice">
          {t(gameErrorKey(error, "profileUi.profileUnavailable"))}
        </p>
      )}
      {!page && busy && <p role="status">{t("profileUi.loadingListings")}</p>}
      {page && !active.length && !busy && (
        <p className="yk-profile-empty">
          {t("profileUi.noCardsListedRightNow")}
        </p>
      )}
      <div className="yk-profile-sales-grid">
        {active.map(item => (
          <button
            type="button"
            key={item.id}
            className="yk-profile-sale"
            onClick={() => setSelected(item.id)}
            aria-label={t("profileUi.viewAuctionFor", { name: item.card.name })}
          >
            <div className="yk-profile-sale-art">
              <YokaiCard
                {...item.card}
                image={item.card.catalogueImage ?? item.card.image}
              />
            </div>
            <div className="yk-profile-sale-meta">
              <Karas amount={item.amount} />
              <span>{t("profileUi.bidCount", { count: item.bids })}</span>
              <span>{t("profileUi.viewAuction")}</span>
            </div>
          </button>
        ))}
      </div>
      {page?.nextCursor && (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void load(page.nextCursor)}
        >
          {busy ? t("packs.loading") : t("profileUi.seeMoreListings")}
        </Button>
      )}
      {selected && (
        <ProfileAuction
          key={selected}
          id={selected}
          ownerId={ownerId}
          adapter={adapter}
          onUpdate={update}
          onClose={() => setSelected(undefined)}
        />
      )}
    </section>
  );
}
