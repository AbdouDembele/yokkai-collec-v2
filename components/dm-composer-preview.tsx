"use client";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { PrivateMessages } from "@/components/private-messages";
import type {
  PrivateMessage,
  PrivateMessagesAdapter
} from "@/lib/data/private-messages";
import type { TradesPanelAdapter } from "@/components/trades";
const friend = { id: "dm-preview-friend", pseudo: "Preview Friend" };
const tradeAdapter: TradesPanelAdapter = {
  friendships: async () => ({ friends: [], incoming: [], outgoing: [] }),
  listOffers: async () => [],
  context: async () => ({ friend, balance: 0, ownCards: [], friendCards: [] }),
  create: async () => "preview",
  cancel: async () => true,
  respond: async () => true
};
export function DmComposerPreview({ docked = true }: { docked?: boolean }) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const messages = useRef<PrivateMessage[]>([]),
    failed = useRef(false);
  const [open, setOpen] = useState(true),
    [attempts, setAttempts] = useState(0),
    [failure, setFailure] = useState(false);
  const adapter = useMemo<PrivateMessagesAdapter>(
    () => ({
      list: async () => ({
        viewerId: "dm-preview-viewer",
        items: [...messages.current],
        next: null
      }),
      send: async (_id, text, id, gifUrl) => {
        setAttempts(n => n + 1);
        if (failed.current)
          throw Error("Couldn't send the message. Your draft has been kept.");
        const message = {
          id,
          senderId: "dm-preview-viewer",
          recipientId: friend.id,
          text,
          gifUrl,
          createdAt: new Date().toISOString()
        };
        messages.current.push(message);
        return message;
      }
    }),
    []
  );
  const content = (
    <PrivateMessages
      friend={friend}
      adapter={adapter}
      tradeAdapter={tradeAdapter}
      docked={docked}
      onClose={() => setOpen(false)}
    />
  );
  return (
    <main className="p-4">
      <button
        className="yk-button"
        onClick={() => {
          failed.current = !failed.current;
          setFailure(failed.current);
        }}
      >
        Toggle send failure
      </button>
      <output data-preview-attempts>{attempts}</output>
      <output data-preview-failure>{String(failure)}</output>
      {mounted &&
        open &&
        createPortal(
          docked ? (
            <aside className="yk-messenger" data-open="true">
              <div className="yk-messenger-panel">
                <header className="yk-messenger-heading">
                  <h2>DM preview</h2>
                </header>
                {content}
              </div>
              <button
                className="yk-messenger-launcher"
                onClick={() => setOpen(false)}
              >
                Messages
              </button>
            </aside>
          ) : (
            content
          ),
          document.body
        )}
    </main>
  );
}
