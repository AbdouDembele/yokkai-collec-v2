"use client";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { PrivateMessages } from "@/components/private-messages";
import { Button } from "@/components/ui";
import type { FriendUser } from "@/lib/data/friends";
import type { PrivateMessagesAdapter } from "@/lib/data/private-messages";
import type { TradesPanelAdapter } from "@/components/trades";
import type { ModerationAdapter } from "@/lib/data/moderation";
export function FriendMessageButton({
  friend,
  adapter,
  tradeAdapter,
  moderationAdapter
}: {
  friend: FriendUser;
  adapter?: PrivateMessagesAdapter;
  tradeAdapter?: TradesPanelAdapter;
  moderationAdapter?: ModerationAdapter;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  function close() {
    setOpen(false);
    window.requestAnimationFrame(() => {
      if (trigger.current?.isConnected)
        trigger.current.focus({ preventScroll: true });
    });
  }
  return (
    <>
      <Button
        variant="secondary"
        data-profile-message
        aria-haspopup="dialog"
        aria-label={t("privateMessages.title", { name: friend.pseudo })}
        onClick={event => {
          trigger.current = event.currentTarget;
          setOpen(true);
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" />
        </svg>
        {t("socialFriends.message")}
      </Button>
      {open &&
        createPortal(
          <PrivateMessages
            key={friend.id}
            friend={friend}
            adapter={adapter}
            tradeAdapter={tradeAdapter}
            moderationAdapter={moderationAdapter}
            onClose={close}
          />,
          document.body
        )}
    </>
  );
}
