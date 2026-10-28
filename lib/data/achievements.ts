import { createClient } from "@/utils/supabase/client";
import { invalidatePlayerSnapshots } from "@/lib/data/cards";

export type Achievement = {
  id: string;
  title: string;
  description: string;
  conditionType: string;
  conditionValue: number;
  conditionCategory: string | null;
  karasReward: number;
  progressCurrent: number;
  progressTarget: number;
  progressLabel: string | null;
  completedAt: string | null;
  claimedAt: string | null;
};

export type ClaimResult = { balance: number; claimedAt: string; reward: number };

function failure(error: { message?: string; code?: string }) {
  const messages: Record<string, string> = {
    AUTH_REQUIRED: "Sign in to view your achievements.",
    PROFILE_MISSING: "Your profile couldn't be found.",
    ACHIEVEMENT_LOCKED: "This achievement isn't complete yet.",
    ACHIEVEMENT_ALREADY_CLAIMED: "This reward has already been claimed.",
  };
  if (error.message && messages[error.message]) return new Error(messages[error.message]);
  if (error.code === "PGRST301") return new Error(messages.AUTH_REQUIRED);
  return new Error("Couldn't load achievements. Please try again in a moment.");
}

export async function getAchievements(): Promise<Achievement[]> {
  const { data, error } = await createClient().rpc("get_achievements");
  if (error) throw failure(error);
  return (data as Achievement[]).map(item => ({ ...item }));
}

export async function claimAchievement(id: string): Promise<ClaimResult> {
  const { data, error } = await createClient().rpc("claim_achievement", { p_achievement_id: id });
  if (error) throw failure(error);
  const result = data as ClaimResult;
  invalidatePlayerSnapshots(["balance"]);
  return result;
}
