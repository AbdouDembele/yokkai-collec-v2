import type { PlayerCosmetics } from "@/components/styled-player-name";
import { createClient } from "@/utils/supabase/client";
import { readRequest } from "@/lib/data/read-request";

export type CommunityRankingKind = "likes" | "licenses";
export type CommunityRankingRequest = {
  offset: number;
  query: string;
  friendsOnly: boolean;
};
export type CommunityRanking = CommunityRankingRequest & {
  limit: number;
  total: number;
  rankedPlayers: number;
  binder: { key: string; license: string; total: number } | null;
  entries: {
    userId: string;
    pseudo: string;
    avatarUrl: string | null;
    position: number;
    value: number;
    isFriend: boolean;
  }[];
  mine: { value: number; isPublic: boolean; position: number | null } | null;
  profileStyles: Record<string, PlayerCosmetics>;
};

export async function getCommunityRanking(
  kind: CommunityRankingKind,
  options: CommunityRankingRequest,
  binderKey = ""
): Promise<CommunityRanking> {
  const { data, error } = await readRequest(signal =>
    createClient()
      .rpc(
        kind === "likes"
          ? "get_profile_likes_leaderboard"
          : "get_license_leaderboard",
        {
          p_offset: options.offset,
          p_limit: 20,
          p_query: options.query,
          p_friends_only: options.friendsOnly,
          ...(kind === "licenses" ? { p_binder_key: binderKey } : {})
        }
      )
      .abortSignal(signal)
  );
  if (error || !data) throw new Error("LEADERBOARD_UNAVAILABLE");
  return data as CommunityRanking;
}

// A nearly complete binder must never be displayed as completed by rounding.
export const completionRatio = (owned: number, total: number) =>
  total > 0 ? Math.min(1, Math.floor((owned * 1000) / total) / 1000) : 0;
