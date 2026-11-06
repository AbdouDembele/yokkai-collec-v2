"use server";
import { getVerifiedUser } from "@/lib/auth/session";
import { proClient } from "@/lib/pro/server";
export async function acknowledgeMaintenanceCompensation() {
  const user = await getVerifiedUser();
  if (!user) return { ok: false };
  const { error } = await proClient()
    .from("maintenance_pack_grants")
    .update({ acknowledged_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("acknowledged_at", null);
  return { ok: !error };
}
