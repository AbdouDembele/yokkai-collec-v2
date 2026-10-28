import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/utils/supabase/config";
import {
  deleteReportedWallContent as remove,
  moderateReportedContent as moderate
} from "./admin-wall-content-core.mjs";

// Server-only Storage client; callers pass paths returned by admin RPCs only.
export function storageAdminClient() {
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Storage cleanup is not configured");
  return createClient(getSupabaseConfig().url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

export function deleteReportedWallContent(
  client: SupabaseClient,
  reportId: string
) {
  return remove(client, reportId, storageAdminClient);
}

export function moderateReportedContent(
  client: SupabaseClient,
  reportId: string
) {
  return moderate(client, reportId, storageAdminClient);
}
