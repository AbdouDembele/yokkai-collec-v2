import { createClient } from "@/utils/supabase/client";
import { invalidatePlayerSnapshots } from "@/lib/data/cards";

export type BlockedUser = { id: string; pseudo: string; avatarUrl?: string | null; createdAt?: string };
export type ReportReason = "harassment" | "inappropriate" | "spam" | "cheating" | "other";
export type ReportInput = { userId: string; reason: ReportReason; contextType: "profile" | "auction_chat" | "wall_post" | "wall_reply" | "private_message"; contextId?: string; details: string; blockAlso: boolean };
export type ModerationAdapter = {
  list: () => Promise<BlockedUser[]>;
  block: (id: string) => Promise<unknown>;
  unblock: (id: string) => Promise<unknown>;
  report: (input: ReportInput) => Promise<unknown>;
};
const db = createClient;
const errors: Record<string, string> = {
  REPORT_CONTEXT_UNAVAILABLE: "Reporting this content isn't available yet.",
  REPORT_DUPLICATE: "You've already reported this player in this context.",
  REPORT_LIMIT: "You've reached the daily limit of 10 reports.",
  REPORT_INVALID: "Couldn't submit this report.",
};
async function call<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  try {
    const { data, error } = await db().rpc(name, args);
    if (error && (args?.p_context_type === "wall_post" || args?.p_context_type === "wall_reply" || args?.p_context_type === "private_message") &&
      (error.message === "REPORT_INVALID" || error.code === "23514" || error.code === "PGRST202" || error.code === "42883"))
      throw new Error(errors.REPORT_CONTEXT_UNAVAILABLE);
    if (error) throw new Error(errors[error.message] ?? "Couldn't complete this action.");
    return data as T;
  } catch (error) {
    if (error instanceof Error && Object.values(errors).includes(error.message)) throw error;
    throw new Error("Couldn't complete this action.");
  }
}
function changed(id: string, blocked: boolean) {
  invalidatePlayerSnapshots(["profile"]);
  window.dispatchEvent(new CustomEvent("player-block-changed", { detail: { id, blocked } }));
}
export const listBlockedUsers = () => call<BlockedUser[]>("list_blocked_users");
export async function blockUser(id: string) { await call("block_user", { p_user_id: id }); changed(id, true); }
export async function unblockUser(id: string) { await call("unblock_user", { p_user_id: id }); changed(id, false); }
export async function reportUser(input: ReportInput) {
  await call("report_user", { p_user_id: input.userId, p_reason: input.reason, p_context_type: input.contextType, p_context_id: input.contextId ?? null, p_details: input.details, p_block_also: input.blockAlso });
  if (input.blockAlso) changed(input.userId, true);
  if (input.contextType === "wall_post" || input.contextType === "wall_reply")
    window.dispatchEvent(new CustomEvent("profile-wall-changed", { detail: { kind: "reported", id: input.contextId } }));
}
export const liveModeration: ModerationAdapter = { list: listBlockedUsers, block: blockUser, unblock: unblockUser, report: reportUser };
