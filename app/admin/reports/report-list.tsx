"use client";
/* eslint-disable @next/next/no-img-element -- private, uncached admin previews and animated GIPHY media. */

import Link from "next/link";
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui";
import {
  setReportStatusAction,
  deleteReportContentAction,
  moderateReportContentAction,
  type ModerationActionState,
  type ReportActionState
} from "./actions";

export type AdminReport = {
  id: string;
  reporterId: string;
  reporterPseudo: string;
  reporterEmail: string;
  reportedId: string;
  reportedPseudo: string;
  reportedEmail: string;
  reportedIsBanned: boolean;
  reason: "harassment" | "inappropriate" | "spam" | "cheating" | "other";
  contextType:
    "profile" | "auction_chat" | "wall_post" | "wall_reply" | "private_message";
  contextId: string | null;
  snapshot: {
    message?: string;
    gifUrl?: string | null;
    hasMedia?: boolean;
    author?: { id?: string; pseudo?: string };
    createdAt?: string;
    postId?: string;
  };
  details: string;
  status: "pending" | "reviewed" | "dismissed";
  createdAt: string;
};

const reasons: Record<AdminReport["reason"], string> = {
  harassment: "Harassment",
  inappropriate: "Inappropriate content",
  spam: "Spam",
  cheating: "Cheating",
  other: "Other"
};
const statuses: Record<
  AdminReport["status"],
  { label: string; style: string }
> = {
  pending: {
    label: "Pending",
    style: "border-amber-300/30 bg-amber-400/10 text-amber-200"
  },
  reviewed: {
    label: "Reviewed",
    style: "border-emerald-300/30 bg-emerald-400/10 text-emerald-200"
  },
  dismissed: {
    label: "Dismissed",
    style: "border-slate-400/30 bg-slate-400/10 text-slate-300"
  }
};
const initialState: ReportActionState = { ok: false, message: "" };

function DeleteContent({ reportId }: { reportId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    deleteReportContentAction,
    initialState
  );
  return (
    <div className="mt-3">
      {(!state.ok || !state.contentDeleted) && (
        <button
          className="yk-button yk-button-secondary"
          onClick={() => setOpen(true)}
        >
          {state.contentDeleted ? "Retry media cleanup" : "Delete content"}
        </button>
      )}
      {state.message && (
        <p role="status" className="mt-2 text-sm">
          {state.message}
        </p>
      )}
      <Modal
        open={open && !state.ok}
        onClose={() => {
          if (!pending) setOpen(false);
        }}
        title="Delete reported content?"
      >
        <p>
          This removes the reported content and its media. Deleting a post also
          removes its replies. The report snapshot is kept.
        </p>
        <form action={action} className="mt-4 flex flex-wrap gap-3">
          <input type="hidden" name="report_id" value={reportId} />
          <button
            type="button"
            className="yk-button yk-button-secondary"
            disabled={pending}
            onClick={() => setOpen(false)}
          >
            Cancel
          </button>
          <button type="submit" className="yk-button" disabled={pending}>
            {pending
              ? "Deleting…"
              : state.contentDeleted
                ? "Retry media cleanup"
                : "Delete content"}
          </button>
        </form>
        {state.message && (
          <p role="status" className="mt-3">
            {state.message}
          </p>
        )}
      </Modal>
    </div>
  );
}

const initialModeration: ModerationActionState = { ok: false, code: "" };

// #379: hide a reported DM, or only a wall item's image or GIF, for everyone.
function ModerateContent({
  reportId,
  privateMessage
}: {
  reportId: string;
  privateMessage: boolean;
}) {
  const t = useTranslations("adminReports");
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    moderateReportContentAction,
    initialModeration
  );
  const label = state.removed
    ? t("retryCleanup")
    : privateMessage
      ? t("hideMessage")
      : t("removeMedia");
  const message = state.code ? t(`result.${state.code}`) : "";
  return (
    <div className="mt-3">
      {!state.ok && (
        <button
          className="yk-button yk-button-secondary"
          onClick={() => setOpen(true)}
        >
          {label}
        </button>
      )}
      {message && (
        <p role="status" className="mt-2 text-sm">
          {message}
        </p>
      )}
      <Modal
        open={open && !state.ok}
        onClose={() => {
          if (!pending) setOpen(false);
        }}
        title={privateMessage ? t("hideMessageTitle") : t("removeMediaTitle")}
      >
        <p>{privateMessage ? t("hideMessageBody") : t("removeMediaBody")}</p>
        <form action={action} className="mt-4 flex flex-wrap gap-3">
          <input type="hidden" name="report_id" value={reportId} />
          <button
            type="button"
            className="yk-button yk-button-secondary"
            disabled={pending}
            onClick={() => setOpen(false)}
          >
            {t("cancel")}
          </button>
          <button type="submit" className="yk-button" disabled={pending}>
            {pending ? t("working") : label}
          </button>
        </form>
        {message && (
          <p role="status" className="mt-3">
            {message}
          </p>
        )}
      </Modal>
    </div>
  );
}

function ReportedImage({ reportId }: { reportId: string }) {
  const t = useTranslations("adminReports");
  const [failed, setFailed] = useState(false);
  if (failed) return <p>{t("imageUnavailable")}</p>;
  return (
    <img
      className="max-h-64 w-auto max-w-full rounded-lg object-contain"
      src={`/api/admin/reports/${reportId}/media`}
      alt={t("imagePreviewAlt")}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function ReportActions({ report }: { report: AdminReport }) {
  const [state, action, pending] = useActionState(
    setReportStatusAction,
    initialState
  );
  return (
    <div>
      <form action={action} className="flex flex-wrap gap-2">
        <input name="report_id" type="hidden" value={report.id} />
        {report.status !== "reviewed" && (
          <button
            className="yk-button"
            disabled={pending}
            name="status"
            type="submit"
            value="reviewed"
          >
            Mark as reviewed
          </button>
        )}
        {report.status !== "dismissed" && (
          <button
            className="yk-button yk-button-secondary"
            disabled={pending}
            name="status"
            type="submit"
            value="dismissed"
          >
            Dismiss
          </button>
        )}
        {report.status !== "pending" && (
          <button
            className="yk-button yk-button-secondary"
            disabled={pending}
            name="status"
            type="submit"
            value="pending"
          >
            Move back to pending
          </button>
        )}
      </form>
      {state.message && (
        <p
          className={`mt-2 text-xs ${state.ok ? "text-emerald-300" : "text-red-300"}`}
          role="status"
        >
          {state.message}
        </p>
      )}
    </div>
  );
}

function reportDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Paris"
  }).format(new Date(value));
}

export function ReportList({
  reports,
  playerHrefBase
}: {
  reports: AdminReport[];
  playerHrefBase: string;
}) {
  const t = useTranslations("adminReports");
  if (!reports.length)
    return (
      <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-10 text-center text-slate-400">
        No reports found.
      </section>
    );
  return (
    <section className="space-y-4">
      {reports.map(report => {
        const status = statuses[report.status];
        return (
          <article
            className="min-w-0 rounded-2xl border border-white/10 bg-slate-900/70 p-5 [overflow-wrap:anywhere]"
            key={report.id}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-2.5 py-1 text-xs font-bold ${status.style}`}
                  >
                    {status.label}
                  </span>
                  <span className="rounded-full border border-red-300/20 bg-red-400/10 px-2.5 py-1 text-xs font-bold text-red-200">
                    {reasons[report.reason]}
                  </span>
                  {report.reportedIsBanned && (
                    <span className="rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-bold text-red-300">
                      Banned player
                    </span>
                  )}
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  Received on {reportDate(report.createdAt)}
                </p>
              </div>
              <span className="text-xs text-slate-600">
                #{report.id.slice(0, 8)}
              </span>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div className="min-w-0 rounded-xl bg-slate-950 p-4">
                <p className="text-xs uppercase tracking-widest text-slate-500">
                  Reported by
                </p>
                <p className="mt-2 font-bold">{report.reporterPseudo}</p>
                <p className="text-sm text-slate-400">{report.reporterEmail}</p>
                {report.reporterId && (
                  <Link
                    className="mt-3 inline-block text-sm font-semibold text-cyan-300 hover:text-cyan-200"
                    href={`${playerHrefBase}${report.reporterId}`}
                  >
                    View this player →
                  </Link>
                )}
              </div>
              <div className="min-w-0 rounded-xl border border-red-300/15 bg-red-950/20 p-4">
                <p className="text-xs uppercase tracking-widest text-red-300/70">
                  Reported player
                </p>
                <p className="mt-2 font-bold">{report.reportedPseudo}</p>
                <p className="text-sm text-slate-400">{report.reportedEmail}</p>
                {report.reportedId && (
                  <Link
                    className="mt-3 inline-block text-sm font-semibold text-cyan-300 hover:text-cyan-200"
                    href={`${playerHrefBase}${report.reportedId}`}
                  >
                    Open admin details →
                  </Link>
                )}
              </div>
            </div>
            <div className="mt-4 rounded-xl border border-white/10 bg-slate-950 p-4">
              <p className="text-xs uppercase tracking-widest text-slate-500">
                Context
              </p>
              <p className="mt-2 text-sm font-semibold">
                {report.contextType === "private_message"
                  ? t("contextPrivateMessage")
                  : report.contextType === "auction_chat"
                    ? "Auction chat message"
                    : report.contextType === "wall_post"
                      ? "Wall post"
                      : report.contextType === "wall_reply"
                        ? "Wall reply"
                        : "Player profile"}
              </p>
              {(report.contextType === "wall_post" ||
                report.contextType === "wall_reply") && (
                <div className="mt-3 space-y-2 text-sm">
                  <p>
                    Author:{" "}
                    {report.snapshot.author?.pseudo ?? report.reportedPseudo}
                  </p>
                  {report.snapshot.createdAt && (
                    <p>Posted on {reportDate(report.snapshot.createdAt)}</p>
                  )}
                  <p>
                    {report.snapshot.hasMedia
                      ? "An image was attached. Private image bytes are not retained in this snapshot."
                      : "No image attachment."}
                  </p>
                  {report.snapshot.hasMedia && (
                    <ReportedImage reportId={report.id} />
                  )}
                  {report.snapshot.postId && (
                    <p>Parent post: {report.snapshot.postId}</p>
                  )}
                  <Link
                    className="inline-flex min-h-11 items-center text-cyan-300"
                    href={`/profile/${encodeURIComponent(report.reportedId)}?tab=wall`}
                  >
                    View author&apos;s wall →
                  </Link>
                </div>
              )}
              {report.snapshot.message && (
                <blockquote className="mt-3 border-l-2 border-cyan-400 pl-3 text-sm text-slate-300">
                  {report.snapshot.message}
                </blockquote>
              )}
              {report.snapshot.gifUrl && (
                <img
                  className="mt-3 block max-h-64 w-auto max-w-full rounded-lg object-contain"
                  src={report.snapshot.gifUrl}
                  alt={t("gifPreviewAlt")}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              )}
              {report.snapshot.gifUrl && (
                <a
                  className="mt-3 inline-block text-sm font-semibold text-cyan-300 hover:text-cyan-200"
                  href={report.snapshot.gifUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  View reported GIF ↗
                </a>
              )}
              {report.details && (
                <div className="mt-4">
                  <p className="text-xs font-semibold text-slate-500">
                    Report details
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">
                    {report.details}
                  </p>
                </div>
              )}
            </div>
            <div className="mt-4">
              <ReportActions report={report} />
              {(report.contextType === "wall_post" ||
                report.contextType === "wall_reply") && (
                <DeleteContent reportId={report.id} />
              )}
              {(report.contextType === "private_message" ||
                ((report.contextType === "wall_post" ||
                  report.contextType === "wall_reply") &&
                  (report.snapshot.hasMedia || !!report.snapshot.gifUrl))) && (
                <ModerateContent
                  reportId={report.id}
                  privateMessage={report.contextType === "private_message"}
                />
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
