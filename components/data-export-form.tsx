"use client";
import { gameErrorKey } from "@/i18n/game-messages";
import { useTranslations, useNow } from "next-intl";

import { useActionState, useState } from "react";
import { packCountdown } from "@/lib/ui/pack-countdown";
import { Button } from "@/components/ui";
import { reconnectForDeletion } from "@/app/settings/actions";

export function DataExportForm() {
  const t = useTranslations();
  const now = useNow({ updateInterval: 1000 });
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [reconnect, setReconnect] = useState(false);
  const [reconnectState, reconnectAction, reconnecting] = useActionState(
    reconnectForDeletion,
    {}
  );

  async function download() {
    setPending(true);
    setError(false);
    setRetryAt(null);
    setMessage("Preparing your data…");
    try {
      const response = await fetch("/api/data-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
        credentials: "same-origin"
      });
      if (!response.ok) {
        const problem = await response.json();
        setReconnect(problem.reconnect === true);
        if (typeof problem.retryAfter === "number")
          setRetryAt(Date.now() + problem.retryAfter * 1000);
        throw new Error(
          typeof problem.error === "string" ? problem.error : "Download failed."
        );
      }
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download =
        response.headers
          .get("Content-Disposition")
          ?.match(/filename="(my-data-\d{4}-\d{2}-\d{2}\.json)"/)?.[1] ??
        "my-data.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
      setMessage(
        "Download started. You can download your data again in 24 hours."
      );
    } catch (failure) {
      setError(true);
      setMessage(
        failure instanceof Error
          ? failure.message
          : "Download failed. Please try again later."
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      id="mes-donnees"
      aria-labelledby="data-export-title"
      className="mt-6 rounded-panel border border-border bg-surface p-6"
    >
      <h2 id="data-export-title" className="font-display text-xl">
        {t("settingsUi.myData")}{" "}
      </h2>
      <p className="mt-3 text-sm leading-6 text-ink-2">
        {t("settingsUi.exportDescription")}{" "}
      </p>
      <p className="mt-2 text-sm leading-6 text-ink-2">
        {t.rich("settingsUi.manualExport", {
          email: chunks => (
            <a
              className="underline underline-offset-2"
              href="mailto:yokkaicollec@gmail.com?subject=Data%20export%20request"
            >
              {chunks}
            </a>
          )
        })}
      </p>
      <div className="mt-6" aria-busy={pending}>
        <Button
          type="button"
          onClick={download}
          disabled={pending || reconnect}
        >
          {pending
            ? t("referralReminder.preparing")
            : t("settingsUi.downloadMyData")}
        </Button>
      </div>
      <p
        role={error ? "alert" : "status"}
        className={`mt-3 text-sm ${error ? "text-danger" : "text-ink-2"}`}
      >
        {message
          ? t(gameErrorKey(message, "settingsUi.downloadRetryLater"))
          : ""}
        {retryAt !== null && (
          <>
            {" "}
            {t("settingsUi.exportCountdown", {
              time: packCountdown(retryAt, now.getTime(), true)
            })}
          </>
        )}
      </p>
      {reconnect && (
        <form action={reconnectAction} className="mt-3">
          <Button type="submit" disabled={reconnecting}>
            {reconnecting
              ? t("signOutButton.signingOut")
              : t("settingsUi.signInAgain")}
          </Button>
          {reconnectState.error && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {t(
                gameErrorKey(
                  reconnectState.error,
                  "settingsUi.couldntSaveSettings"
                )
              )}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
