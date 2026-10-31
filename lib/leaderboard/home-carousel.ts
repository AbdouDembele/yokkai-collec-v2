import { createClient } from "@/utils/supabase/client";
import { readRequest } from "@/lib/data/read-request";
import type {
  CommunityRanking,
  CommunityRankingKind
} from "@/lib/leaderboard/community";
import { stableBindersEnabled } from "@/lib/data/binders";

export const HOME_RANKING_INTERVAL_MS = 5000;
export type HomeRankingKind = "collection" | "likes" | "licenses";
export const HOME_RANKING_KINDS = ["collection", "likes", "licenses"] as const;
export const homeRankingHref = (kind: HomeRankingKind) =>
  kind === "collection" ? "/leaderboard" : `/leaderboard?ranking=${kind}`;
export async function getHomeCommunityRanking(
  kind: CommunityRankingKind
): Promise<CommunityRanking> {
  const { data, error } = await readRequest(signal =>
    createClient()
      .rpc(
        kind === "likes"
          ? "get_profile_likes_leaderboard"
          : "get_license_leaderboard",
        {
          p_offset: 0,
          p_limit: 6,
          p_query: "",
          p_friends_only: false,
          ...(kind === "licenses"
            ? {
                p_binder_key:
                  "global:progress-score" +
                  (stableBindersEnabled() ? "" : ":legacy")
              }
            : {})
        }
      )
      .abortSignal(signal)
  );
  if (error || !data) throw new Error("LEADERBOARD_UNAVAILABLE");
  return data as CommunityRanking;
}
