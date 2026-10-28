"use server";

import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createClient as createStorageClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/utils/supabase/config";

import {
  discardAuthorizedWallMedia,
  deleteOwnWallPost
} from "@/lib/server/wall-media-cleanup.mjs";

function storageClient() {
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Storage cleanup unavailable");
  return createStorageClient(getSupabaseConfig().url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}
async function authenticatedClient() {
  const client = createClient(await cookies());
  const { data, error } = await client.auth.getUser();
  return error || !data.user ? null : client;
}
export async function discardModeratedReplyMedia(path: string) {
  const client = await authenticatedClient();
  return client
    ? discardAuthorizedWallMedia(client, path, storageClient)
    : { ok: false };
}
export async function deleteWallPost(id: string) {
  const client = await authenticatedClient();
  return client ? deleteOwnWallPost(client, id, storageClient) : { ok: false };
}
