"use client";

import { createClient } from "@/utils/supabase/client";

export type CardReportReason = "image_issue" | "wrong_license" | "duplicate_card";

const messages: Record<string, string> = {
  REPORT_DUPLICATE: "You've already reported this issue for this card.",
  REPORT_LIMIT: "You've reached today's report limit.",
  REPORT_INVALID: "This report is invalid.",
  AUTH_REQUIRED: "Sign in to report this card.",
};

export async function reportCard(cardId: string, reason: CardReportReason) {
  const { error } = await createClient().rpc("report_card", { p_card_id: cardId, p_reason: reason });
  if (!error) return;
  const known = Object.entries(messages).find(([code]) => error.message.includes(code));
  throw new Error(known?.[1] ?? "Couldn't send this report.");
}
