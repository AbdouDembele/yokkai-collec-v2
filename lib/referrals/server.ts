import "server-only";

import { cookies } from "next/headers";
import type { ReferralRank, ReferralStatus } from "@/lib/referrals/shared";
import { createClient } from "@/utils/supabase/server";

export async function getReferralStatus(): Promise<ReferralStatus> {
  const supabase = createClient(await cookies());
  const [{ data, error }, ranking] = await Promise.all([
    supabase.rpc("get_referral_status"),
    supabase.rpc("get_referral_rank")
  ]);
  if (error || !data || typeof data !== "object") {
    return {
      code: null,
      verifiedReferrals: 0,
      packsEarned: 0,
      bonusPacks: 0
    };
  }
  const status = data as Record<string, unknown>;
  return {
    code: typeof status.code === "string" ? status.code : null,
    verifiedReferrals:
      typeof status.verifiedReferrals === "number"
        ? status.verifiedReferrals
        : 0,
    packsEarned:
      typeof status.packsEarned === "number" ? status.packsEarned : 0,
    bonusPacks: typeof status.bonusPacks === "number" ? status.bonusPacks : 0,
    rank: ranking.error || !ranking.data ? null : (ranking.data as ReferralRank)
  };
}
