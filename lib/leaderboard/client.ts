import { createClient } from "@/utils/supabase/client";
import { readRequest } from "@/lib/data/read-request";
import type { CollectionLeaderboard, ReferralLeaderboard } from "./shared";

export async function getCollectionLeaderboard(
  offset = 0,
  query = "",
  friendsOnly = false
): Promise<CollectionLeaderboard> {
  const client = createClient();
  const { data, error } = await readRequest(signal =>
    client
      .rpc("get_collection_leaderboard", {
        p_offset: offset,
        p_limit: 100,
        p_query: query,
        p_friends_only: friendsOnly
      })
      .abortSignal(signal)
  );
  if (error || !data)
    throw new Error("Couldn't load the leaderboard. Please try again.");
  return data as CollectionLeaderboard;
}

export async function getReferralLeaderboard(
  offset = 0,
  query = "",
  friendsOnly = false
): Promise<ReferralLeaderboard> {
  const { data, error } = await readRequest(signal =>
    createClient()
      .rpc("get_referral_leaderboard", {
        p_offset: offset,
        p_limit: 100,
        p_query: query,
        p_friends_only: friendsOnly
      })
      .abortSignal(signal)
  );
  if (error || !data)
    throw new Error(
      "Couldn't load the referral leaderboard. Please try again."
    );
  return data as ReferralLeaderboard;
}
