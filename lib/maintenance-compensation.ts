import "server-only";
import { proClient } from "@/lib/pro/server";
// The server supplies the authenticated ID; the browser cannot choose recipients.
export async function hasUnseenMaintenanceCompensation(userId: string) {
  try {
    const { data, error } = await proClient()
      .from("maintenance_pack_grants")
      .select("user_id")
      .eq("user_id", userId)
      .is("acknowledged_at", null)
      .maybeSingle();
    return !error && Boolean(data);
  } catch {
    return false;
  }
}
