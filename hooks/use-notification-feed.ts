"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getNotifications,
  NotificationRequestError,
  subscribeNotifications,
  type AppNotification
} from "@/lib/data/notifications";
import { invalidatePlayerSnapshots } from "@/lib/data/cards";
import type { PlayerSnapshotScope } from "@/lib/data/player-state";
import { startVisiblePolling } from "@/lib/ui/visible-polling";

const POLL_INTERVAL_MS = 30_000;

// Polls list_notifications and refreshes on demand (panel opening) and when the tab becomes visible again.
// A refresh requested while another one is in flight is dropped, so triggers never stack requests.
export function useNotificationFeed(
  enabled = true,
  load: () => Promise<AppNotification[]> = getNotifications
) {
  const [notifications, setNotifications] = useState<AppNotification[]>();
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const seen = useRef(new Set<string>());
  const refresh = useCallback(() => {
    if (!enabled || document.hidden || inFlight.current)
      return Promise.resolve();
    inFlight.current = true;
    return load()
      .then(
        items => {
          if (mounted.current) {
            const scopes = new Set<PlayerSnapshotScope>();
            for (const item of items) {
              if (seen.current.has(item.id)) continue;
              if (
                [
                  "auction_won",
                  "auction_sold",
                  "trade_offer_accepted"
                ].includes(item.type)
              ) {
                scopes.add("collection");
                scopes.add("balance");
              } else if (item.type === "outbid") scopes.add("balance");
            }
            seen.current = new Set(items.map(item => item.id));
            setNotifications(items);
            setError("");
            if (scopes.size) invalidatePlayerSnapshots([...scopes]);
          }
        },
        failure => {
          if (process.env.NODE_ENV !== "production")
            console.error("[notifications] list_notifications failed", {
              message:
                failure instanceof Error ? failure.message : String(failure),
              code:
                failure instanceof NotificationRequestError
                  ? failure.code
                  : undefined,
              error: failure
            });
          if (mounted.current) setError("Couldn't load your notifications.");
        }
      )
      .finally(() => {
        inFlight.current = false;
      });
  }, [enabled, load]);
  useEffect(() => {
    if (!enabled) return;
    mounted.current = true;
    const stop = startVisiblePolling(() => void refresh(), POLL_INTERVAL_MS);
    const stopRealtime =
      load === getNotifications
        ? subscribeNotifications(() => void refresh())
        : () => {};
    const onBlock = () => {
      void refresh();
    };
    window.addEventListener("player-block-changed", onBlock);
    return () => {
      mounted.current = false;
      stop();
      stopRealtime();
      window.removeEventListener("player-block-changed", onBlock);
    };
  }, [enabled, refresh, load]);
  const retry = useCallback(() => {
    setError("");
    void refresh();
  }, [refresh]);
  return { notifications, setNotifications, error, refresh, retry };
}
