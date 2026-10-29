"use client";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import {
  auctionMentionParts,
  type MentionPlayer
} from "@/lib/ui/auction-mentions";
import {
  PlayerProfilePreview,
  type PlayerPreviewAdapter
} from "@/components/player-profile-preview";
export function AuctionMessageText({
  message,
  players,
  adapter
}: {
  message: string;
  players: MentionPlayer[];
  adapter?: PlayerPreviewAdapter;
}) {
  const t = useTranslations();
  const [previewPlayer, setPreviewPlayer] = useState<
    (MentionPlayer & { trigger: HTMLButtonElement }) | null
  >(null);
  return (
    <>
      {" "}
      <span className="yk-auction-chat-message">
        {auctionMentionParts(message, players).map((part, index) =>
          part.player ? (
            <button
              type="button"
              className="yk-auction-chat-mention"
              key={index}
              aria-haspopup="dialog"
              aria-label={t("playerPreview.open", {
                name: part.player.pseudo
              })}
              onClick={event =>
                setPreviewPlayer({
                  ...part.player!,
                  trigger: event.currentTarget
                })
              }
            >
              {part.text}
            </button>
          ) : (
            part.text
          )
        )}
      </span>{" "}
      {previewPlayer &&
        createPortal(
          <PlayerProfilePreview
            key={previewPlayer.userId}
            player={previewPlayer}
            returnFocus={previewPlayer.trigger}
            adapter={adapter}
            onClose={() => setPreviewPlayer(null)}
          />,
          document.body
        )}
    </>
  );
}
