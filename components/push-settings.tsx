"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/utils/supabase/client";
import { disablePushSubscription } from "@/lib/data/push-subscriptions";

export function PushSettings({ userId }: { userId: string }) {
  const t = useTranslations("settingsUi");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState("pushLoading");
  const [error, setError] = useState(false);
  const [available, setAvailable] = useState(false);
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    let active = true;
    async function load() {
      const ios =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone;
      let reason = "pushDescription";
      if (ios && !standalone) reason = "pushIos";
      else if (
        !window.isSecureContext ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      )
        reason = "pushUnsupported";
      else if (!publicKey) reason = "pushUnavailable";
      else if (Notification.permission === "denied") reason = "pushDenied";
      if (reason !== "pushDescription") {
        if (active) {
          setNotice(reason);
          setBusy(false);
        }
        return;
      }
      // Registering prepares the worker; it never asks for notification permission.
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none"
      });
      const subscription = await registration.pushManager.getSubscription();
      let owned = false;
      if (subscription) {
        const { data, error } = await createClient()
          .from("push_subscriptions")
          .select("endpoint")
          .eq("user_id", userId)
          .eq("endpoint", subscription.endpoint)
          .maybeSingle();
        if (error) throw error;
        owned = Boolean(data);
      }
      if (active) {
        setEnabled(owned);
        setAvailable(true);
        setNotice(reason);
        setBusy(false);
      }
    }
    void load().catch(() => {
      if (active) {
        setError(true);
        setNotice("pushError");
        setBusy(false);
      }
    });
    return () => {
      active = false;
    };
  }, [publicKey, userId]);

  async function toggle() {
    setBusy(true);
    setError(false);
    try {
      if (enabled) {
        await disablePushSubscription();
        setEnabled(false);
      } else {
        // This is the ONLY permission request, before any asynchronous preparation.
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setNotice(permission === "denied" ? "pushDenied" : "pushDismissed");
          if (permission === "denied") setAvailable(false);
          return;
        }
        const registration = await navigator.serviceWorker.ready;
        // A shared browser must never retain another account's subscription.
        const previous = await registration.pushManager.getSubscription();
        if (previous && !(await previous.unsubscribe()))
          throw new Error("PUSH_UNSUBSCRIBE_FAILED");
        const bytes = Uint8Array.from(
          atob(publicKey!.replace(/-/g, "+").replace(/_/g, "/")),
          c => c.charCodeAt(0)
        );
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: bytes
        });
        const json = subscription.toJSON();
        const { error } = await createClient()
          .from("push_subscriptions")
          .upsert(
            {
              user_id: userId,
              endpoint: subscription.endpoint,
              p256dh: json.keys?.p256dh,
              auth: json.keys?.auth
            },
            { onConflict: "endpoint" }
          );
        if (error) {
          await subscription.unsubscribe();
          throw error;
        }
        setEnabled(true);
      }
      setNotice("pushDescription");
    } catch {
      setError(true);
      setNotice("pushError");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="mb-6 rounded-panel border border-veil bg-surface p-6"
      aria-busy={busy}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-48">
          <h2 id="push-title" className="font-display text-xl">
            {t("pushTitle")}
          </h2>
          <p
            id="push-notice"
            role={error ? "alert" : "status"}
            className="mt-3 text-sm leading-6 text-ink-2"
          >
            {t(notice)}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-labelledby="push-title"
          aria-describedby="push-notice"
          aria-checked={enabled}
          disabled={busy || !available}
          onClick={() => void toggle()}
          className="yk-shiny-toggle min-h-11 shrink-0"
        >
          <span>{t(enabled ? "pushEnabled" : "pushDisabled")}</span>
          <i aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
