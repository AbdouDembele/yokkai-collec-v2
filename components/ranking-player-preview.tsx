"use client";
import dynamic from "next/dynamic";
import { useState, type MouseEvent } from "react";
const Preview = dynamic(() =>
  import("@/components/player-profile-preview").then(
    m => m.PlayerProfilePreview
  )
);

export function useRankingPlayerPreview() {
  const [player, setPlayer] = useState<{
    userId: string;
    pseudo: string;
    trigger: HTMLElement;
  } | null>(null);
  const onClickCapture = (event: MouseEvent<HTMLElement>) => {
    if (
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey ||
      !(event.target instanceof Element)
    )
      return;
    if (event.target.closest("dialog")) return;
    const link = event.target.closest<HTMLAnchorElement>(
      'a[href^="/profile/"]'
    );
    if (!link || !event.currentTarget.contains(link)) return;
    const pseudo = decodeURIComponent(
      new URL(link.href).pathname.slice("/profile/".length)
    );
    if (!pseudo) return;
    event.preventDefault();
    setPlayer({ userId: pseudo, pseudo, trigger: link });
  };
  return {
    onClickCapture,
    opened: player !== null,
    preview: player ? (
      <Preview
        player={player}
        returnFocus={player.trigger}
        onClose={() => setPlayer(null)}
      />
    ) : null
  };
}
