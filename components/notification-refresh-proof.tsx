"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { notificationItem, Topbar } from "@/components/topbar";
import { useNotificationFeed } from "@/hooks/use-notification-feed";
import type { AppNotification } from "@/lib/data/notifications";

const now = new Date().toISOString();
const initial: AppNotification[] = [
  {
    id: "n1",
    type: "friend_request",
    referenceId: "u1",
    readAt: null,
    createdAt: now,
    cardName: null,
    actorPseudo: "Mochi",
    achievementName: null
  }
];
const fresh: AppNotification = {
  id: "n2",
  type: "outbid",
  referenceId: "a1",
  readAt: null,
  createdAt: now,
  cardName: "Kitsune d’argent",
  actorPseudo: null,
  achievementName: null
};
const wait = (ms: number) =>
  new Promise(resolve => window.setTimeout(resolve, ms));

// Mounts the real Topbar and the real notification hook with a loader that counts calls instead of calling list_notifications.
export function NotificationRefreshProof() {
  const server = useRef({ items: initial, calls: 0, delay: 20 });
  const [checks, setChecks] = useState<{ label: string; ok: boolean }[]>([]);
  const started = useRef(false);
  const load = useCallback(async () => {
    server.current.calls += 1;
    await wait(server.current.delay);
    return server.current.items;
  }, []);
  const feed = useNotificationFeed(true, load);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let visibility: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility
    });
    const setVisibility = (state: DocumentVisibilityState) => {
      visibility = state;
      document.dispatchEvent(new Event("visibilitychange"));
    };
    const bell = () =>
      document.querySelector<HTMLButtonElement>(
        'button[aria-controls="notifications-panel"]'
      )!;
    const check = (label: string, ok: boolean) =>
      setChecks(current => [...current, { label, ok }]);
    const run = async () => {
      await wait(150);
      server.current.items = [fresh, ...initial];
      let before = server.current.calls;
      bell().click();
      await wait(150);
      check(
        "Ouverture du panneau → 1 lecture",
        server.current.calls === before + 1
      );
      check(
        "La notification arrivée entre deux pollings est affichée",
        !!document
          .querySelector("#notifications-panel")
          ?.textContent?.includes("Kitsune d’argent")
      );
      before = server.current.calls;
      bell().click();
      await wait(100);
      check(
        "Fermeture du panneau → aucune lecture",
        server.current.calls === before
      );
      before = server.current.calls;
      setVisibility("hidden");
      await wait(100);
      check("Onglet masqué → aucune lecture", server.current.calls === before);
      setVisibility("visible");
      await wait(100);
      check(
        "Retour sur l’onglet → 1 lecture",
        server.current.calls === before + 1
      );
      server.current.delay = 400;
      before = server.current.calls;
      bell().click();
      setVisibility("hidden");
      setVisibility("visible");
      await wait(600);
      check(
        "Ouverture + retour simultanés → 1 seule requête",
        server.current.calls === before + 1
      );
      delete (document as { visibilityState?: unknown }).visibilityState;
    };
    void run();
  }, []);
  const passed = checks.length === 6 && checks.every(item => item.ok);
  return (
    <div className="yk-social-stack">
      <div
        className={`yk-feedback ${passed ? "yk-feedback-success" : ""}`}
        data-proof-result={
          passed
            ? "passed"
            : checks.some(item => !item.ok)
              ? "failed"
              : "running"
        }
      >
        <strong>
          {passed
            ? "Preuve d’intégration réussie"
            : "Test des déclencheurs en cours…"}
        </strong>
        <span>
          {checks.filter(item => item.ok).length}/6 déclencheurs vérifiés
        </span>
      </div>
      <Topbar
        view="wishlist"
        name="Kitsune"
        karas={4920}
        notifications={(feed.notifications ?? []).map(notificationItem)}
        notificationError={feed.error || undefined}
        onRetryNotifications={feed.retry}
        onRefreshNotifications={() => void feed.refresh()}
        onReadAll={() => {}}
        onOpenNotification={async () => {}}
      />
      <ul id="notification-refresh-proof-log">
        {checks.map(item => (
          <li key={item.label} data-ok={item.ok}>
            {item.ok ? "✓" : "✗"} {item.label}
          </li>
        ))}
      </ul>
      <div className="min-h-96" />
    </div>
  );
}
