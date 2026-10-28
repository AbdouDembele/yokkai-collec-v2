"use client";
import { gameErrorKey } from "@/i18n/game-messages";
import { useTranslations } from "next-intl";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { reportCard, type CardReportReason } from "@/lib/data/card-reports";
import { Button, Feedback, Modal } from "@/components/ui";

const reasons: { value: CardReportReason; label: string }[] = [
  { value: "image_issue", label: "Image issue" },
  { value: "wrong_license", label: "Incorrect franchise" },
  { value: "duplicate_card", label: "Duplicate card" }
];

export function CardReportButton({
  cardId,
  cardName,
  sendReport = reportCard,
  className = "",
  iconOnly = false
}: {
  iconOnly?: boolean;
  cardId: string;
  cardName: string;
  sendReport?: typeof reportCard;
  className?: string;
}) {
  const tu = useTranslations("collectionShared");
  const tError = useTranslations();

  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<CardReportReason | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const show = () => {
    setOpen(true);
    setError("");
    setSent(false);
  };
  const close = () => {
    if (!busy) setOpen(false);
  };
  const submit = async () => {
    if (!reason || busy) return;
    setBusy(true);
    setError("");
    try {
      await sendReport(cardId, reason);
      setSent(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? gameErrorKey(cause)
          : "collectionShared.couldntSendThisReport"
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="danger"
        className={className}
        aria-label={tu("reportNamedCard", { name: cardName })}
        title={tu("reportThisCard")}
        onClick={show}
      >
        <span aria-hidden="true" className={iconOnly ? "text-xl" : undefined}>
          ⚑
        </span>
        {!iconOnly && tu("reportThisCardLeadingSpace")}
      </Button>
      {mounted &&
        open &&
        createPortal(
          <div
            onClick={event => event.stopPropagation()}
            onKeyDown={event => event.stopPropagation()}
          >
            <Modal
              open={open}
              onClose={close}
              title={tu("reportThisCard")}
              className="yk-card-report-modal"
            >
              {sent ? (
                <>
                  <Feedback tone="success" title={tu("reportSent")}>
                    {tu("theTeamCanReview")}
                    {cardName} {tu("inTheAdminPanel")}
                  </Feedback>
                  <div className="mt-6 flex justify-end">
                    <Button onClick={close}>{tu("close")}</Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-ink-2">
                    {tu("whatIssueDidYouNoticeWith")}{" "}
                    <strong className="text-ink">{cardName}</strong>?
                  </p>
                  <fieldset className="mt-5 space-y-3">
                    <legend className="sr-only">{tu("reportReason")}</legend>
                    {reasons.map(item => (
                      <label
                        className={`yk-card-report-reason ${reason === item.value ? "is-selected" : ""}`}
                        key={item.value}
                      >
                        <input
                          type="radio"
                          name={`card-report-${cardId}`}
                          value={item.value}
                          checked={reason === item.value}
                          onChange={() => setReason(item.value)}
                        />
                        <span>
                          {tu("reportReasonLabel", { reason: item.value })}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  {error && (
                    <p className="mt-4 text-sm text-danger-ink" role="alert">
                      {tError(gameErrorKey(error))}
                    </p>
                  )}
                  <div className="mt-6 flex flex-wrap justify-end gap-3">
                    <Button variant="secondary" disabled={busy} onClick={close}>
                      {tu("cancel")}
                    </Button>
                    <Button
                      variant="danger"
                      disabled={!reason || busy}
                      onClick={() => void submit()}
                    >
                      {busy ? tu("sending") : tu("sendReport")}
                    </Button>
                  </div>
                </>
              )}
            </Modal>
          </div>,
          document.body
        )}
    </>
  );
}
