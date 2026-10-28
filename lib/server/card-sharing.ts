import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/utils/supabase/config";
import type { Rarity } from "@/lib/data/cards";

export type SharedCard = {
  cardName: string;
  franchise: string | null;
  category?: string;
  rarity: Rarity;
  shiny: boolean;
  isEvolved?: boolean;
  catalogueImageUrl: string;
  pseudo?: string;
};

const rarities = new Set<Rarity>(["C", "R", "SR", "SSR", "LR"]);
let client: ReturnType<typeof createClient> | undefined;

export const isShareId = (value: string) => /^[0-9a-f]{32}$/.test(value);

export function isShareImageUrl(url: string): boolean {
  try {
    const source = new URL(url);
    if (source.protocol !== "https:" || source.username || source.password)
      return false;
    if (
      source.origin === "https://i.imgur.com" ||
      source.origin === "https://imgur.com"
    ) {
      return source.pathname.length > 1;
    }
    return (
      source.origin === new URL(getSupabaseConfig().url).origin &&
      source.pathname.startsWith("/storage/v1/object/public/card-images/")
    );
  } catch {
    return false;
  }
}

function db() {
  if (!client) {
    const { url, key } = getSupabaseConfig();
    client = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
  }
  return client;
}

export async function getSharedCard(id: string): Promise<SharedCard | null> {
  if (!isShareId(id)) return null;
  const database = db() as unknown as {
    rpc: (
      name: string,
      args: Record<string, string>
    ) => Promise<{ data: unknown; error: unknown }>;
  };
  const { data, error } = await database.rpc("get_shared_card", {
    p_share_id: id
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data))
    return null;
  const value = data as Record<string, unknown>;
  if (
    typeof value.cardName !== "string" ||
    (value.franchise !== null && typeof value.franchise !== "string") ||
    typeof value.rarity !== "string" ||
    !rarities.has(value.rarity as Rarity) ||
    typeof value.shiny !== "boolean" ||
    typeof value.catalogueImageUrl !== "string"
  )
    return null;
  return {
    cardName: value.cardName,
    franchise: value.franchise,
    ...(typeof value.category === "string" ? { category: value.category } : {}),
    rarity: value.rarity as Rarity,
    shiny: value.shiny,
    ...(typeof value.isEvolved === "boolean"
      ? { isEvolved: value.isEvolved }
      : {}),
    catalogueImageUrl: value.catalogueImageUrl,
    ...(typeof value.pseudo === "string" ? { pseudo: value.pseudo } : {})
  };
}
