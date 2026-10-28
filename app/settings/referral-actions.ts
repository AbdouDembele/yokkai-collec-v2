"use server";

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

export type ReferralActionState = {
  code?: string;
  error?: string;
};

export async function createReferralLink(
  previousState: ReferralActionState,
  formData: FormData
): Promise<ReferralActionState> {
  void previousState;
  void formData;
  const supabase = createClient(await cookies());
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser();
  if (authError || !user) return { error: "Sign in again to continue." };

  const { data, error } = await supabase.rpc("create_referral_code");
  if (error || typeof data !== "string") {
    return { error: "Couldn't create your referral link. Try again." };
  }
  return { code: data };
}
