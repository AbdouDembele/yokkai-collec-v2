"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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

export async function applySmurfSanctionAction(form: FormData) {
  await requireAdminAction();
  const smurfUserId = String(form.get("smurf_user_id") ?? "");
  const primaryUserId = String(form.get("primary_user_id") ?? "");
  const confirmation = String(form.get("confirmation") ?? "");
  const note = String(form.get("note") ?? "").trim();
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    !uuid.test(smurfUserId) ||
    !uuid.test(primaryUserId) ||
    confirmation !== smurfUserId ||
    smurfUserId === primaryUserId
  )
    throw new Error("SMURF_SANCTION_INVALID");
  if (note.length < 10 || note.length > 2000)
    throw new Error("SMURF_SANCTION_NOTE_INVALID");
  const client = createClient(await cookies());
  const result = await client.rpc("admin_apply_smurf_sanction", {
    p_smurf_user_id: smurfUserId,
    p_primary_user_id: primaryUserId,
    p_note: note,
    p_confirmation: confirmation
  });
  if (result.error) throw new Error("SMURF_SANCTION_UNAVAILABLE");
  revalidatePath("/admin/security");
  revalidatePath("/admin/players");
  redirect(
    `/admin/security?sanction=${smurfUserId}&primary=${primaryUserId}&result=smurf-sanction-applied`
  );
}
