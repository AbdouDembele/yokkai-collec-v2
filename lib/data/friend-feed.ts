import { createClient } from "@/utils/supabase/client";
import { readRequest } from "@/lib/data/read-request";
import type { PlayerCosmetics } from "@/components/styled-player-name";

export type FriendFeedCursor = { at: string; id: string };
export type FeedRelationship = "self" | "friends" | "outgoing_pending" | "incoming_pending" | "none";
export type FriendFeedPost = {
  relationship?: FeedRelationship;
  requestId?: string | null;
  activity?: import("./wall-interactions").WallActivity | null;
  id: string;
  text: string;
  hasMedia: boolean;
  gifUrl: string | null;
  createdAt: string;
  author: {
    id: string;
    name: string;
    avatarUrl: string | null;
    profileStyle?: PlayerCosmetics | null;
  };
};
export type FriendFeedPage = {
  available?: boolean;
  items: FriendFeedPost[];
  next: FriendFeedCursor | null;
};
export type FriendFeedLoader = (cursor?: FriendFeedCursor | null) => Promise<FriendFeedPage>;

export const getFriendFeed: FriendFeedLoader = async cursor => {
  const { data, error } = await readRequest(signal =>
    createClient().rpc("get_home_wall_feed", {
      p_before: cursor?.at ?? null,
      p_before_id: cursor?.id ?? null,
      p_limit: 10
    }).abortSignal(signal)
  ).catch(() => { throw new Error(feedErrorMessage()); });
  if (error) throw new Error(feedErrorMessage(error.message));
  return data as FriendFeedPage;
};

export function feedErrorMessage(code?: string) {
  if (code === "AUTH_REQUIRED") return "Sign in again to load your feed.";
  if (code === "FEED_CURSOR_INVALID") return "This feed page is no longer available. Refresh your feed and try again.";
  return "Couldn't load your timeline. Please try again.";
}

export function appendFeedPage(current: FriendFeedPost[], next: FriendFeedPost[]) {
  return [...new Map([...current, ...next].map(post => [post.id, post])).values()];
}

// No private/home-feed fallback: before migration Everyone remains unavailable.
export const getPublicFeed: FriendFeedLoader = async cursor => {
  const { data, error } = await readRequest(signal =>
    createClient().rpc("get_public_wall_feed", {
      p_before: cursor?.at ?? null, p_before_id: cursor?.id ?? null, p_limit: 10
    }).abortSignal(signal)
  ).catch(() => { throw new Error(feedErrorMessage()); });
  if (error?.code === "PGRST202" || error?.code === "42883") return {items: [], next: null, available: false};
  if (error) throw new Error(feedErrorMessage(error.message));
  return data as FriendFeedPage;
};
