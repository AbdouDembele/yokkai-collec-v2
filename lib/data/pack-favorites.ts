import { createClient } from "@/utils/supabase/client";
import { readRequest } from "@/lib/data/read-request";

// One bounded, read-only request for the entire opening; no player data cache.
export async function getPackFavoriteCardIds(ids: readonly string[], signal?: AbortSignal): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const { data, error } = await readRequest(deadline => createClient()
    .rpc("get_pack_favorite_card_ids", {
      p_card_ids: unique,
      p_stable: process.env.NEXT_PUBLIC_STABLE_BINDERS_ENABLED === "true"
    })
    .abortSignal(signal ? AbortSignal.any([signal, deadline]) : deadline));
  if (error) throw error;
  // The projection can only decorate card IDs already present in this opening.
  return Array.isArray(data) ? data.filter((id): id is string => typeof id === "string" && unique.includes(id)) : [];
}
