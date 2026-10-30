import { createClient } from "@/utils/supabase/client";
import { readRequest } from "@/lib/data/read-request";
import { stableBindersEnabled } from "@/lib/data/binders";
import type { PaniniAlbumPage } from "@/lib/data/cards";
export async function getRankingLicenseChoices({
  query = "",
  category = "",
  prefix = "",
  page = 1,
  pageSize = 72
}: {
  query?: string;
  category?: string;
  prefix?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<PaniniAlbumPage> {
  const size = Math.min(72, Math.max(1, Math.trunc(pageSize)));
  const { data, error } = await readRequest(signal =>
    createClient()
      .rpc("get_ranking_license_choices", {
        p_query: query,
        p_category: category,
        p_prefix: prefix,
        p_stable: stableBindersEnabled(),
        p_offset: (Math.max(1, Math.trunc(page)) - 1) * size,
        p_limit: size
      })
      .abortSignal(signal)
  );
  if (error || !data) throw new Error("LICENSE_CHOICES_UNAVAILABLE");
  return data as PaniniAlbumPage;
}
