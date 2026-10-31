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
  history?: import("./progress").RankHistory;
  limit: number;
  total: number;
  rankedPlayers: number;
  binder: { key: string; license: string; total: number } | null;
  catalogue?: { totalCards: number; totalLicenses: number };
  metric?: "overall" | "completed" | "cards" | "completion-score";
  scoreVersion?: number;
  completionWeights?: Record<string, number>;
  entries: {
    userId: string;
    pseudo: string;
    avatarUrl: string | null;
    position: number;
    value: number;
    completionScore?: number;
    completedLicenses?: number;
    distinctCards?: number;
    isFriend: boolean;
  }[];
  mine: {
    value: number;
    isPublic: boolean;
    position: number | null;
    completionScore?: number;
    completedLicenses?: number;
    distinctCards?: number;
  } | null;
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

// One bounded protected read; co-leaders share one group instead of repeating #1.
export function leadingLicenseEntries(entries: CommunityRanking["entries"]) {
  if (!entries.length) return [];
  const best = Math.max(...entries.map(entry => entry.value));
  return entries.filter(entry => entry.value === best);
}

export async function getLicenseLeaders(
  binderKey: string,
  signal?: AbortSignal
): Promise<CommunityRanking> {
  const { data, error } = await readRequest(timeoutSignal =>
    createClient()
      .rpc("get_license_leaderboard", {
        p_binder_key: binderKey,
        p_offset: 0,
        p_limit: 100,
        p_query: "",
        p_friends_only: false
      })
      .abortSignal(
        signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
      )
  );
  if (error || !data) throw new Error("LEADERBOARD_UNAVAILABLE");
  const ranking = data as CommunityRanking;
  return { ...ranking, entries: leadingLicenseEntries(ranking.entries) };
}
