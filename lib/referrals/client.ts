import { createClient } from "@/utils/supabase/client";
import type { ReferralPage } from "@/lib/referrals/shared";

export async function getMyReferrals(offset = 0): Promise<ReferralPage> {
  const { data, error } = await createClient().rpc("get_my_referrals", {
    p_offset: offset,
    p_limit: 20
  });
  if (error || !data || !Array.isArray(data.referrals))
    throw new Error("Couldn't load your referrals. Please try again.");
  return data as ReferralPage;
}
