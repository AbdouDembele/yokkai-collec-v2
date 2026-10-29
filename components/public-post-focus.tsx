"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useSocialFeeds } from "@/components/social-feed-provider";
import { Button } from "@/components/ui";
import { publicPostCursor } from "@/lib/ui/public-post-link";
import { startVisiblePolling } from "@/lib/ui/visible-polling";

export function PublicPostFocus() {
  const t = useTranslations("homeFriendFeed.postNavigation"),
    query = useSearchParams();
  const id = query.get("post"),
    at = query.get("at");
  const store = useSocialFeeds().public;
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  const [status, setStatus] = useState(""),
    [retry, setRetry] = useState(0);
  const scrolled = useRef("");
  useEffect(() => {
    const cursor = publicPostCursor(id, at);
    if (!cursor || !id) return;
    let active = true;
    const refresh = () => {
      void Promise.resolve().then(async () => {
        if (!active || document.hidden) return;
        setStatus("loading");
        const result = await store.locate(id, cursor);
        if (active && result !== "cancelled") setStatus(result);
      });
    };
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string }>).detail;
      if (!detail?.id || detail.id === id) refresh();
    };
    const stop = startVisiblePolling(refresh, 60_000);
    window.addEventListener("player-block-changed", refresh);
    window.addEventListener("profile-wall-changed", changed);
    return () => {
      active = false;
      stop();
      window.removeEventListener("player-block-changed", refresh);
      window.removeEventListener("profile-wall-changed", changed);
    };
  }, [id, at, retry, store]);
  useEffect(() => {
    if (!id || status !== "found" || !state.items.some(post => post.id === id))
      return;
    const node = document.getElementById("public-post-" + id);
    if (!node) return;
    node.dataset.publicPostFocused = "true";
    const frame =
      scrolled.current !== id
        ? requestAnimationFrame(() => {
            node.scrollIntoView({ block: "start", behavior: "instant" });
            node.focus({ preventScroll: true });
            scrolled.current = id;
          })
        : undefined;
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      delete node.dataset.publicPostFocused;
    };
  }, [id, status, state.items]);
  if (!publicPostCursor(id, at) || !status || status === "found") return null;
  return (
    <div
      className="yk-profile-notice"
      role={status === "failed" ? "alert" : "status"}
    >
      <p>
        {t(
          status === "missing"
            ? "unavailable"
            : status === "failed"
              ? "failed"
              : "loading"
        )}
      </p>
      {status === "failed" && (
        <Button
          variant="secondary"
          onClick={() => setRetry(value => value + 1)}
        >
          {t("retry")}
        </Button>
      )}
    </div>
  );
}
