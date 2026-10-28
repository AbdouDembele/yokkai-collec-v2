"use client";

import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui";
import {
  PlayerDetailPanel,
  type AdminPlayerDetail
} from "../players/player-manager";

export function ReportedPlayerModal({
  player,
  closeHref
}: {
  player: AdminPlayerDetail | null;
  closeHref: string;
}) {
  const router = useRouter();
  if (!player) return null;
  return (
    <Modal
      open
      onClose={() => router.push(closeHref)}
      title={`Admin details for ${player.pseudo}`}
      className="max-w-3xl"
    >
      <PlayerDetailPanel selected={player} />
    </Modal>
  );
}
