"use client";

import Link from "next/link";
import { useRankingPlayerPreview } from "@/components/ranking-player-preview";
import { RankingIcon } from "@/components/ranking-icon";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode
} from "react";
import { useTranslations } from "next-intl";
import { HomeCommunityRanking } from "@/components/home-community-ranking";
import type {
  CommunityRanking,
  CommunityRankingKind
} from "@/lib/leaderboard/community";
import {
  getHomeCommunityRanking,
  HOME_RANKING_INTERVAL_MS,
  HOME_RANKING_KINDS,
  homeRankingHref
} from "@/lib/leaderboard/home-carousel";
import "@/styles/home-leaderboard.css";

function subscribeMotion(callback: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
const reducedSnapshot = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const serverSnapshot = () => false;
type PageState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: CommunityRanking };

export function HomeRankingCarousel({
  userId,
  powerRanking
}: {
  userId: string;
  powerRanking: ReactNode;
}) {
  const playerPreview = useRankingPlayerPreview();
  const t = useTranslations("homeRankingCarousel"),
    names = useTranslations("communityRanking");
  const [index, setIndex] = useState(0);
  const [activeHeight, setActiveHeight] = useState<number>();
  const [hovered, setHovered] = useState(false),
    [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false),
    [hidden, setHidden] = useState(false);
  const [pages, setPages] = useState<Record<CommunityRankingKind, PageState>>({
    likes: { status: "loading" },
    licenses: { status: "loading" }
  });
  const root = useRef<HTMLDivElement>(null),
    requests = useRef<
      Partial<Record<CommunityRankingKind, Promise<CommunityRanking>>>
    >({});
  const reduced = useSyncExternalStore(
    subscribeMotion,
    reducedSnapshot,
    serverSnapshot
  );
  const isPaused = reduced,
    kind = HOME_RANKING_KINDS[index];
  const label = (value: typeof kind) =>
    names(
      value === "collection"
        ? "powerRankingTab"
        : value === "likes"
          ? "likesTab"
          : "licensesTab"
    );
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      entries => setVisible(entries.some(entry => entry.isIntersecting)),
      { threshold: 0.15 }
    );
    observer.observe(node);
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    for (const next of ["likes", "licenses"] as const) {
      const request = (requests.current[next] ??=
        getHomeCommunityRanking(next));
      void request
        .then(data => {
          if (active)
            setPages(current =>
              current[next].status === "ready" && current[next].data === data
                ? current
                : {
                    ...current,
                    [next]: { status: "ready", data }
                  }
            );
        })
        .catch(() => {
          if (active)
            setPages(current => ({ ...current, [next]: { status: "error" } }));
        });
    }
    return () => {
      active = false;
    };
  }, [visible, userId]);
  useEffect(() => {
    if (
      isPaused ||
      hovered ||
      focused ||
      !visible ||
      hidden ||
      playerPreview.opened
    )
      return;
    const timer = window.setInterval(
      () => setIndex(current => (current + 1) % HOME_RANKING_KINDS.length),
      HOME_RANKING_INTERVAL_MS
    );
    return () => window.clearInterval(timer);
  }, [
    isPaused,
    hovered,
    focused,
    visible,
    hidden,
    index,
    playerPreview.opened
  ]);
  const retry = (next: CommunityRankingKind) => {
    setPages(current => ({ ...current, [next]: { status: "loading" } }));
    const request = getHomeCommunityRanking(next);
    requests.current[next] = request;
    void request
      .then(data =>
        setPages(current => ({ ...current, [next]: { status: "ready", data } }))
      )
      .catch(() =>
        setPages(current => ({ ...current, [next]: { status: "error" } }))
      );
  };
  useEffect(() => {
    const resize = () =>
      setActiveHeight(
        Math.min(
          window.innerWidth < 600 ? 560 : 420,
          Math.max(320, window.innerHeight - 260)
        )
      );
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  return (
    <div
      onClickCapture={playerPreview.onClickCapture}
      className="yk-home-ranking-carousel"
      ref={root}
      role="region"
      aria-roledescription={t("carouselRole")}
      aria-label={t("label")}
      style={
        {
          "--home-ranking-height": activeHeight
            ? activeHeight + "px"
            : undefined
        } as CSSProperties
      }
      data-active-ranking={kind}
      data-paused={isPaused}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setFocused(false);
      }}
    >
      <div className="yk-home-ranking-toolbar">
        <div
          className="yk-home-ranking-choices"
          role="group"
          aria-label={t("chooseRanking")}
        >
          {HOME_RANKING_KINDS.map((value, i) => (
            <button
              key={value}
              type="button"
              aria-pressed={index === i}
              aria-controls={`home-ranking-slide-${value}`}
              onClick={() => setIndex(i)}
            >
              <RankingIcon kind={value} />
              {label(value)}
            </button>
          ))}
        </div>
        <div className="yk-home-ranking-actions">
          <Link
            href={homeRankingHref(kind)}
            className="yk-button yk-button-primary yk-home-panel-action"
          >
            {t("viewRanking")} <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </div>
      <div
        className="yk-home-ranking-viewport"
        style={{ height: activeHeight }}
      >
        <div
          className="yk-home-ranking-track"
          style={
            { "--home-ranking-offset": `-${index * 100}%` } as CSSProperties
          }
          aria-live={isPaused || hovered || focused ? "polite" : "off"}
        >
          {HOME_RANKING_KINDS.map(value => (
            <div
              key={value}
              id={`home-ranking-slide-${value}`}
              className="yk-home-ranking-slide"
              tabIndex={kind === value ? 0 : -1}
              role="group"
              aria-roledescription={t("slideRole")}
              aria-label={label(value)}
              aria-hidden={kind !== value}
              inert={kind !== value}
            >
              {value === "collection" ? (
                powerRanking
              ) : pages[value].status === "ready" ? (
                <HomeCommunityRanking
                  userId={userId}
                  kind={value}
                  data={pages[value].data}
                />
              ) : (
                <div className="yk-home-ranking-state">
                  <p
                    role={pages[value].status === "error" ? "alert" : "status"}
                  >
                    {t(
                      pages[value].status === "error"
                        ? "unavailable"
                        : "loading"
                    )}
                  </p>
                  {pages[value].status === "error" && (
                    <button
                      className="yk-button yk-button-secondary"
                      type="button"
                      onClick={() => retry(value)}
                    >
                      {t("retry")}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {playerPreview.preview}
    </div>
  );
}
