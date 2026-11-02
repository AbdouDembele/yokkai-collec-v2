"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAdminAction } from "@/lib/auth/admin";
import { createClient } from "@/utils/supabase/server";

const statuses = new Set(["open", "reviewed", "dismissed"]);

export async function reviewAnticheatCaseAction(form: FormData) {
  await requireAdminAction();
  const userId = String(form.get("user_id") ?? "");
  const status = String(form.get("status") ?? "");
  const note = String(form.get("note") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !statuses.has(status))
    throw new Error("ANTICHEAT_REVIEW_INVALID");
  if (note.length < 5 || note.length > 2000)
    throw new Error("ANTICHEAT_REVIEW_NOTE_INVALID");
  const client = createClient(await cookies());
  const result = await client.rpc("admin_review_anticheat_case", {
    p_user_id: userId,
    p_status: status,
    p_note: note
  });
  if (result.error) throw new Error("ANTICHEAT_REVIEW_UNAVAILABLE");
  revalidatePath("/admin/security");
}
