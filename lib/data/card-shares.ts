import { createClient } from "@/utils/supabase/client";

export type CardShare = {
  id: string;
  cardName: string;
  rarity: string;
  shiny: boolean;
  isEvolved?: boolean;
  showPseudo: boolean;
  createdAt: string;
};

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await createClient().rpc(name, args);
  if (error) {
    const messages: Record<string, string> = {
      AUTH_REQUIRED: "Sign in to manage your links.",
      CARD_NOT_OWNED: "You no longer own this card copy.",
      CARD_SHARE_DAILY_LIMIT: "You've reached the limit of 10 new links per UTC day.",
    };
    throw new Error(messages[error.message] ?? "Shared links are temporarily unavailable.");
  }
  return data as T;
}

export const createCardShare = (instanceId: string, showPseudo: boolean) =>
  call<string>("create_card_share", { p_instance_id: instanceId, p_show_pseudo: showPseudo });
export const deleteCardShare = (id: string) =>
  call<boolean>("delete_card_share", { p_share_id: id });
export const listCardShares = (offset = 0) =>
  call<CardShare[]>("list_card_shares", { p_offset: offset });

export function cardShareUrl(id: string) {
  if (!/^[0-9a-f]{32}$/.test(id)) throw new Error("Invalid share link.");
  const origin = process.env.NEXT_PUBLIC_SITE_URL;
  if (!origin) throw new Error("The site's public address is unavailable.");
  return new URL(`/share/${id}`, origin).href;
}
