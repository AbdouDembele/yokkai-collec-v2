import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { storageAdminClient } from "@/lib/server/admin-wall-content";
import { wallMediaResponse } from "@/lib/server/profile-wall-media.mjs";

// #379: private preview of a reported wall image for admins. The RPC checks the
// admin role and returns only the item's current path (none once removed).
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const missing = () =>
    new Response(null, {
      status: 404,
      headers: { "Cache-Control": "private, no-store" }
    });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return missing();
  try {
    const { data: path, error } = await createClient(await cookies()).rpc(
      "admin_get_reported_wall_media",
      { p_report_id: id }
    );
    if (error || typeof path !== "string") return missing();
    const { data: blob, error: downloadError } = await storageAdminClient()
      .storage.from("profile-wall-media")
      .download(path);
    if (downloadError || !blob) return missing();
    return await wallMediaResponse(blob);
  } catch {
    return missing();
  }
}
