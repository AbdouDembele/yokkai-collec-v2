"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/auth/admin";
import { createClient } from "@/utils/supabase/server";

export type PlayerAdminActionState = { ok: boolean; message: string };

export async function removePlayerCardAction(
  instanceId: string
): Promise<PlayerAdminActionState> {
  try {
    await requireAdminAction();
    if (!/^[0-9a-f-]{36}$/i.test(instanceId))
      throw new Error("Invalid card ID.");
    const client = createClient(await cookies());
    const { error } = await client.rpc("admin_remove_player_card", {
      p_card_instance_id: instanceId
    });
    if (error) {
      if (error.message.includes("CARD_FROZEN"))
        throw new Error("This card is currently at auction.");
      if (error.message.includes("CARD_IN_TRADE"))
        throw new Error("This card is part of a pending trade.");
      if (error.message.includes("CARD_NOT_FOUND"))
        throw new Error("This card is no longer in the collection.");
      throw error;
    }
    revalidatePath("/admin/players");
    return { ok: true, message: "Card removed from the collection." };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Unable to remove this card."
    };
  }
}

export async function setPlayerBanAction(
  _previous: PlayerAdminActionState,
  form: FormData
): Promise<PlayerAdminActionState> {
  try {
    await requireAdminAction();
    const userId = String(form.get("user_id") ?? "");
    const banned = String(form.get("banned") ?? "") === "true";
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Invalid player ID.");
    const client = createClient(await cookies());
    const { error } = await client.rpc("admin_set_user_ban", {
      p_user_id: userId,
      p_banned: banned
    });
    if (error) {
      if (error.message.includes("CANNOT_BAN_SELF"))
        throw new Error("You cannot ban your own account.");
      if (error.message.includes("CANNOT_BAN_ADMIN"))
        throw new Error("An administrator account cannot be banned here.");
      throw error;
    }
    revalidatePath("/admin/players");
    return {
      ok: true,
      message: banned
        ? "The player has been banned, their listings cancelled, their bids removed and their held Karas refunded."
        : "The player has been unbanned."
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Unable to complete this action."
    };
  }
}
