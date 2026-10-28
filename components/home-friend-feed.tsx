"use client";
import { useLocale, useTranslations } from "next-intl";
import { i18nEnabled } from "@/i18n/locale";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore
} from "react";
import { Avatar } from "@/components/ui";
import { StyledPlayerName } from "@/components/styled-player-name";
import { ProfileWall } from "@/components/profile-wall";
import { type WallAdapter } from "@/lib/data/profile-wall";
import type { WallInteractions } from "@/lib/data/wall-interactions";
import {
  getFriendFeed,
  type FriendFeedPage,
  type FriendFeedPost,
  type FriendFeedLoader
} from "@/lib/data/friend-feed";
import "@/styles/friend-feed.css";

const subscribeToHydration = () => () => {};

export function HomeFriendFeed({
  initial,
  initialError = "",
  viewer,
  wallAdapter,
  load = getFriendFeed
}: {
  initial: FriendFeedPage;
  initialError?: string;
  viewer?: FriendFeedPost["author"];
  wallAdapter?: WallAdapter;
  interactions?: WallInteractions;
  load?: FriendFeedLoader;
}) {
  const t = useTranslations("homeFriendFeed");
  const locale = useLocale();
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false
  );
  const [page, setPage] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const request = useRef(0);
  const timeline = useRef<HTMLDivElement>(null);
  const cancel = useCallback(() => {
    request.current++;
  }, []);

  useEffect(() => {
    const id = ++request.current;
    void Promise.resolve().then(() => {
      if (request.current !== id) return;
      setPage(initial);
      setBusy(false);
      setError(initialError);
    });
    return cancel;
  }, [initial, initialError, cancel]);

  const reload = useCallback(
    async (clear = false) => {
      const id = ++request.current;
      setBusy(true);
      setError("");
      // Block changes hide cached posts immediately; ordinary refreshes keep previews.
      if (clear) setPage({ items: [], next: null });
      try {
        const next = await load();
        if (id === request.current) setPage(next);
      } catch {
        if (id === request.current) {
          setPage({ items: [], next: null });
          setError("refreshFailed");
        }
      } finally {
        if (id === request.current) {
          setBusy(false);
        }
      }
    },
    [load]
  );

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void reload();
    };
    const blockChanged = () => void reload(true);
    window.addEventListener("focus", refresh);
    window.addEventListener("player-block-changed", blockChanged);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("player-block-changed", blockChanged);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [reload]);

  useEffect(() => {
    const strip = timeline.current;
    if (!strip) return;
    const scroll = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY))
        return;
      if (strip.scrollWidth <= strip.clientWidth || !event.deltaY) return;
      event.preventDefault();
      strip.scrollLeft +=
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? strip.clientWidth
            : 1);
    };
    strip.addEventListener("wheel", scroll, { passive: false });
    return () => strip.removeEventListener("wheel", scroll);
  }, []);

  return (
    <section className="yk-friend-feed" aria-labelledby="home-friend-feed">
      <header className="yk-feed-heading">
        <div>
          <h2 id="home-friend-feed">{t("friendFeed")}</h2>
          <Link href="/social">{t("seeAll")}</Link>
        </div>
        <Link
          href="/profile?tab=wall"
          className="yk-button yk-button-primary yk-home-panel-action"
        >
          {t("viewMyWall")}
          <span aria-hidden="true">↗</span>
        </Link>
      </header>
      {viewer && (
        <div id="home-feed-composer" className="yk-feed-composer" hidden>
          <ProfileWall
            ownerId={viewer.id}
            pseudo={viewer.name}
            avatarUrl={viewer.avatarUrl}
            isMe
            isPublic={false}
            canRead
            active
            composerOnly
            adapter={wallAdapter}
            onPublished={() => {
              timeline.current?.scrollTo({ left: 0, top: 0 });
              void reload();
            }}
          />
          <p className="yk-feed-publish-note">
            {t("postsAppearHereOnYourWallAndInYourFriends")}
          </p>
        </div>
      )}
      <div
        className="yk-feed-timeline"
        ref={timeline}
        tabIndex={0}
        aria-label={t("friendsWallPosts")}
        aria-busy={busy}
      >
        {error && (
          <p role="alert" className="yk-feed-empty">
            {error === "refreshFailed" ? t("refreshFailed") : error}
          </p>
        )}
        {busy && !page.items.length && (
          <p role="status" className="yk-feed-empty">
            {t("loadingYourTimeline")}
          </p>
        )}
        {!busy && !error && !page.items.length && (
          <div className="yk-feed-empty">
            <h3>{t("yourTimelineStartsWithYourFriends")}</h3>
            <p>{t("shareAPostOnYourWallOrAddFriendsTo")}</p>
            <Link href="/social/friends">
              {t("findFriends")}
              <span aria-hidden="true">↗</span>
            </Link>
          </div>
        )}
        {page.items.slice(0, 10).map(post => {
          const wall = `/profile/${encodeURIComponent(post.author.id)}?tab=wall`;
          return (
            <article
              className="yk-feed-post"
              key={post.id}
              data-feed-post={post.id}
              data-has-media={Boolean(post.hasMedia || post.gifUrl)}
            >
              <Link
                href={wall}
                aria-label={t("viewPlayerWall", { player: post.author.name })}
                className="yk-feed-avatar"
              >
                <Avatar
                  name={post.author.name}
                  image={post.author.avatarUrl ?? undefined}
                  size={42}
                />
              </Link>
              <div className="yk-feed-post-content">
                <header>
                  <Link href={wall} className="yk-feed-author">
                    <StyledPlayerName
                      name={post.author.name}
                      cosmetics={post.author.profileStyle ?? undefined}
                    />
                  </Link>
                  <span aria-hidden="true">·</span>
                  <time dateTime={post.createdAt}>
                    {i18nEnabled() && !hydrated
                      ? "…"
                      : new Date(post.createdAt).toLocaleString(
                          i18nEnabled() && locale === "fr" ? "fr-FR" : "en-US",
                          {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit"
                          }
                        )}
                  </time>
                </header>
                {(post.hasMedia || post.gifUrl) && (
                  <Link
                    href={wall}
                    className="yk-feed-media-preview"
                    aria-label={t("viewPlayerPost", {
                      player: post.author.name
                    })}
                  >
                    <img
                      src={
                        post.hasMedia
                          ? `/api/profile-wall/media/${post.id}`
                          : post.gifUrl!
                      }
                      alt={post.gifUrl ? t("sharedGif") : t("sharedImage")}
                      loading="lazy"
                      decoding="async"
                      className="yk-feed-media"
                    />
                  </Link>
                )}
                {post.text && <p className="yk-feed-text">{post.text}</p>}
                <Link href={wall} className="yk-feed-wall-link">
                  {t("viewWall")}
                  <span aria-hidden="true">↗</span>
                </Link>
              </div>
            </article>
          );
        })}
        {!page.next && page.items.length > 0 && (
          <p className="yk-feed-end">{t("youReAllCaughtUp")}</p>
        )}
      </div>
    </section>
  );
}
