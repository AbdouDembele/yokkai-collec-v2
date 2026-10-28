"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode
} from "react";
import { usePathname } from "next/navigation";
import { getFriendFeed, getPublicFeed } from "@/lib/data/friend-feed";
import { hydrateFeedActivity } from "@/lib/data/wall-interactions";
import { createSocialFeedStore } from "@/lib/ui/social-feed-store";

type FeedStore = ReturnType<typeof createSocialFeedStore>;
const SocialFeeds = createContext<{
  friends: FeedStore;
  public: FeedStore;
} | null>(null);

export function SocialFeedProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const feeds = useMemo(
    () => ({
      friends: createSocialFeedStore(getFriendFeed, hydrateFeedActivity),
      public: createSocialFeedStore(getPublicFeed, hydrateFeedActivity)
    }),
    []
  );

  useEffect(() => {
    // This first public page doubles as the capability probe for the tab.
    const probe = () => {
      if (
        !document.hidden &&
        feeds.public.getSnapshot().available === undefined
      )
        void feeds.public.refresh();
    };
    probe();
    document.addEventListener("visibilitychange", probe);
    return () => {
      document.removeEventListener("visibilitychange", probe);
      feeds.friends.dispose();
      feeds.public.dispose();
    };
  }, [feeds]);

  useEffect(() => {
    const refresh = () => {
      if (document.hidden) return;
      if (pathname === "/social") void feeds.friends.refresh();
      if (pathname === "/social/everyone") void feeds.public.refresh();
    };
    const clear = () => {
      feeds.friends.clear();
      feeds.public.clear();
      refresh();
    };
    const changed = (event: Event) => {
      const { id, kind } = (event as CustomEvent<{ id: string; kind: string }>)
        .detail;
      if (kind === "deleted") {
        feeds.friends.removed(id);
        feeds.public.removed(id);
      }
      refresh();
    };
    window.addEventListener("player-block-changed", clear);
    window.addEventListener("profile-wall-changed", changed);
    return () => {
      window.removeEventListener("player-block-changed", clear);
      window.removeEventListener("profile-wall-changed", changed);
    };
  }, [feeds, pathname]);

  return <SocialFeeds.Provider value={feeds}>{children}</SocialFeeds.Provider>;
}

export function useSocialFeeds() {
  const feeds = useContext(SocialFeeds);
  if (!feeds) throw new Error("SocialFeedProvider is required.");
  return feeds;
}
