"use server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  PRODUCT_UPDATE_ID,
  PRODUCT_UPDATE_METADATA_KEY
} from "@/lib/ui/product-updates";

// Cosmetic acknowledgement only. The session determines the account, never an input ID.
export async function acknowledgeProductUpdate(): Promise<{ ok: boolean }> {
  try {
    const client = createClient(await cookies());
    const {
      data: { user },
      error
    } = await client.auth.getUser();
    if (error || !user) return { ok: false };
    if (user.user_metadata?.[PRODUCT_UPDATE_METADATA_KEY] === PRODUCT_UPDATE_ID)
      return { ok: true };
    const saved = await client.auth.updateUser({
      data: { [PRODUCT_UPDATE_METADATA_KEY]: PRODUCT_UPDATE_ID }
    });
    return { ok: !saved.error };
  } catch {
    return { ok: false };
  }
}
