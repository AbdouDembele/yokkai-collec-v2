"use client";
import { gameErrorKey } from "@/i18n/game-messages";
import { useTranslations } from "next-intl";

import { useState } from "react";
import { Button, Modal, Toast } from "@/components/ui";
import {
  liveModeration,
  type ModerationAdapter,
  type ReportInput,
  type ReportReason
} from "@/lib/data/moderation";

const reasons: [ReportReason, string][] = [
  ["harassment", "Harassment or insults"],
  ["inappropriate", "Inappropriate content, image, or GIF"],
  ["spam", "Spam"],
  ["cheating", "Cheating or fake accounts"],
  ["other", "Other"]
];
export function PlayerModeration({
  userId,
  pseudo,
  blockedByMe = false,
  contextId,
  contextType,
  onBlocked,
  onReported,
  adapter = liveModeration
}: {
  userId: string;
  pseudo: string;
  blockedByMe?: boolean;
  contextId?: string;
  contextType?: ReportInput["contextType"];
  onBlocked?: () => void;
  onReported?: () => void;
  adapter?: ModerationAdapter;
}) {
  const t = useTranslations();
  const [sheet, setSheet] = useState<"block" | "report" | null>(null);
  const [reason, setReason] = useState<ReportReason>("harassment");
  const [details, setDetails] = useState("");
  const [blockAlso, setBlockAlso] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  function open(next: "block" | "report") {
    setError("");
    setSuccess("");
    setDetails("");
    setBlockAlso(false);
    setReason("harassment");
    setSheet(next);
  }
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (sheet === "block") {
        await adapter.block(userId);
        onBlocked?.();
      } else {
        await adapter.report({
          userId,
          reason,
          contextType: contextType ?? (contextId ? "auction_chat" : "profile"),
          contextId,
          details,
          blockAlso
        });
        if (blockAlso) onBlocked?.();
        setSuccess("Thanks, your report has been submitted.");
        onReported?.();
      }
      setSheet(null);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Couldn't complete this action."
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="relative">
      {contextId ? (
        <button
          type="button"
          className="inline-flex min-h-11 items-center text-xs text-ink-3 underline hover:text-ink"
          aria-label={t("profileUi.reportContent", {
            name: pseudo,
            kind: contextType ?? "message"
          })}
          onClick={() => open("report")}
        >
          {t("profileUi.report")}{" "}
        </button>
      ) : (
        <details className="relative">
          <summary
            className="yk-button yk-button-secondary cursor-pointer"
            aria-label={t("profileUi.playerActions", { name: pseudo })}
          >
            ⋯
          </summary>
          <div className="absolute right-0 z-10 mt-2 flex min-w-40 flex-col gap-2 rounded-panel border border-veil bg-surface p-3">
            {!blockedByMe && (
              <Button variant="danger" onClick={() => open("block")}>
                {t("profileUi.block")}{" "}
              </Button>
            )}
            <Button variant="secondary" onClick={() => open("report")}>
              {t("profileUi.report")}{" "}
            </Button>
          </div>
        </details>
      )}
      <Toast
        message={
          success
            ? t(gameErrorKey(success, "profileUi.profileUnavailable"))
            : ""
        }
        onDismiss={() => setSuccess("")}
      />
      <Modal
        open={sheet !== null}
        onClose={() => {
          if (!busy) setSheet(null);
        }}
        title={
          sheet === "block"
            ? t("profileUi.blockPlayer", { name: pseudo })
            : t("profileUi.reportPlayer", { name: pseudo })
        }
        className="max-w-lg"
      >
        {sheet === "block" ? (
          <p className="text-sm leading-6 text-ink-2">
            {t("profileUi.removeFriendNotice")}{" "}
          </p>
        ) : (
          <div className="space-y-4">
            <label className="block text-sm">
              {t("profileUi.reason")}{" "}
              <select
                className="auth-input mt-2"
                value={reason}
                disabled={busy}
                onChange={event =>
                  setReason(event.target.value as ReportReason)
                }
              >
                {reasons.map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(`profileUi.reason${label.split(" ")[0]}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              {t("profileUi.optionalDetails")}{" "}
              <textarea
                className="auth-input mt-2 min-h-28"
                maxLength={500}
                value={details}
                disabled={busy}
                onChange={event => setDetails(event.target.value)}
              />
              <span className="mt-1 block text-right text-xs text-ink-3">
                {details.length}/500
              </span>
            </label>
            {!blockedByMe && (
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={blockAlso}
                  disabled={busy}
                  onChange={event => setBlockAlso(event.target.checked)}
                />
                {t("profileUi.alsoBlockThisPlayer")}{" "}
              </label>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm text-danger-ink">
            {t(gameErrorKey(error, "profileUi.profileUnavailable"))}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setSheet(null)}
          >
            {t("packs.cancel")}{" "}
          </Button>
          <Button
            variant={sheet === "block" ? "danger" : "primary"}
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy
              ? t("collectionShared.sending")
              : sheet === "block"
                ? t("profileUi.block")
                : t("profileUi.submitReport")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
