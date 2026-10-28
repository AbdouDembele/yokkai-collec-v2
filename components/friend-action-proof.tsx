"use client";

import { useEffect, useRef, useState } from "react";
import { FriendAction, type FriendActionAdapter } from "@/components/friends";
import type { FriendshipStatus } from "@/lib/data/friends";

type EventName =
  | "sendFriendRequest"
  | "respondFriendRequest:true"
  | "respondFriendRequest:false";
const contexts = ["Profil public", "Page Amis"] as const;

function InteractiveCase({
  context,
  status,
  action,
  onEvent
}: {
  context: string;
  status: FriendshipStatus;
  action?: "accept" | "refuse";
  onEvent: (context: string, event: EventName) => void;
}) {
  const userId = `${context}-${status}-${action ?? "state"}`;
  const adapter: FriendActionAdapter = {
    send: async id => {
      if (id !== userId) throw new Error("Identifiant incorrect");
      onEvent(context, "sendFriendRequest");
    },
    friendships: async () => ({
      friends: [],
      outgoing: [],
      incoming: [
        { id: userId, pseudo: "Mochi", requestId: `request-${userId}` }
      ]
    }),
    respond: async (requestId, accept) => {
      if (requestId !== `request-${userId}`)
        throw new Error("Demande incorrecte");
      onEvent(context, `respondFriendRequest:${accept}`);
    }
  };
  return (
    <div
      className="yk-friend-proof-case"
      data-proof={`${context}:${status}:${action ?? "state"}`}
    >
      <small>{action ? `Demande reçue · ${action}` : status}</small>
      <FriendAction userId={userId} status={status} adapter={adapter} />
    </div>
  );
}

export function FriendActionProof() {
  const [events, setEvents] = useState<string[]>([]);
  const started = useRef(false);
  const record = (context: string, event: EventName) =>
    setEvents(current =>
      current.includes(`${context}:${event}`)
        ? current
        : [...current, `${context}:${event}`]
    );
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const click = (selector: string, label: string) => {
      const root = document.querySelector<HTMLElement>(
        `[data-proof="${selector}"]`
      );
      const button = [...(root?.querySelectorAll("button") ?? [])].find(item =>
        item.textContent?.includes(label)
      );
      button?.click();
    };
    const run = async () => {
      await new Promise(resolve => window.setTimeout(resolve, 50));
      for (const context of contexts)
        click(`${context}:none:state`, "Ajouter en ami");
      for (const context of contexts)
        click(`${context}:incoming:accept`, "Accepter");
      await new Promise(resolve => window.setTimeout(resolve, 50));
      for (const context of contexts) {
        click(`${context}:incoming:refuse`, "Refuser");
        await new Promise(resolve => window.setTimeout(resolve, 50));
        const dialog = [
          ...document.querySelectorAll<HTMLDialogElement>("dialog[open]")
        ].at(-1);
        const confirm = [...(dialog?.querySelectorAll("button") ?? [])].find(
          item => item.textContent?.trim() === "Refuser"
        );
        confirm?.click();
        await new Promise(resolve => window.setTimeout(resolve, 50));
      }
    };
    void run();
  }, []);
  const expected = contexts.length * 3;
  return (
    <div className="yk-social-stack">
      <div
        className={`yk-feedback ${events.length === expected ? "yk-feedback-success" : ""}`}
        role="status"
        data-proof-result={events.length === expected ? "passed" : "running"}
      >
        <strong>
          {events.length === expected
            ? "Preuve d’intégration réussie"
            : "Test des clics en cours…"}
        </strong>
        <span>
          {events.length}/{expected} appels vérifiés
        </span>
      </div>
      {contexts.map(context => (
        <section className="yk-social-panel" key={context}>
          <h2 className="yk-section-title">{context}</h2>
          <div className="yk-friend-proof-grid">
            <InteractiveCase context={context} status="none" onEvent={record} />
            <InteractiveCase
              context={context}
              status="incoming"
              action="accept"
              onEvent={record}
            />
            <InteractiveCase
              context={context}
              status="incoming"
              action="refuse"
              onEvent={record}
            />
            <InteractiveCase
              context={context}
              status="outgoing"
              onEvent={record}
            />
            <InteractiveCase
              context={context}
              status="accepted"
              onEvent={record}
            />
          </div>
        </section>
      ))}
      <pre id="friend-action-proof-log">{events.join("\n")}</pre>
    </div>
  );
}
