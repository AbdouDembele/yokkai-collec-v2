"use client";
import dynamic from "next/dynamic";
import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui";
import type { ProfileAdapter } from "@/components/profile";
import "@/styles/player-profile-preview.css";

const CompactProfile = dynamic(() =>
  import("@/components/profile").then(module => module.ProfileExperience)
);
export type PlayerPreviewAdapter = ProfileAdapter;
export function PlayerProfilePreview({
  player,
  onClose,
  returnFocus,
  adapter
}: {
  player: { userId: string; pseudo: string };
  onClose: () => void;
  returnFocus?: HTMLElement;
  adapter?: PlayerPreviewAdapter;
}) {
  const t = useTranslations("playerPreview");
  useEffect(() => {
    const trigger = returnFocus;
    return () => {
      // Nested collection dialogs may restore focus during their own cleanup.
      // Restore the mention after all child dialogs have finished closing.
      window.requestAnimationFrame(() => {
        if (
          trigger instanceof HTMLElement &&
          trigger.isConnected &&
          !document.querySelector("dialog[open]")
        )
          trigger.focus({ preventScroll: true });
      });
    };
  }, [returnFocus]);
  return (
    <Modal
      open
      onClose={onClose}
      title={player.pseudo}
      className="yk-player-preview"
    >
      <CompactProfile
        key={player.userId}
        identifier={player.userId}
        compact
        adapter={adapter}
      />
      <Link
        className="yk-button yk-button-secondary yk-player-preview-link"
        href={"/profile/" + encodeURIComponent(player.pseudo)}
      >
        {t("fullProfile")}
      </Link>
    </Modal>
  );
}
