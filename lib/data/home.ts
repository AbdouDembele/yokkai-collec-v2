import type { Card, PackStatus, DecisionPackStatus } from "@/lib/data/cards";
import type { PlayerCosmetics } from "@/components/styled-player-name";

export type HomeCard = Card & { instanceId: string; obtainedAt: string; shiny: boolean };
export type BigPull = { instanceId: string; obtainedAt: string; card: Card & { shiny: boolean }; playerId: string | null; playerName: string | null; avatarUrl?: string | null; profileStyle?: PlayerCosmetics | null };
export type HomePackStatus = PackStatus & { serverNow: number; canResume?: boolean };

export function decisionPackSummary(status: DecisionPackStatus): PackStatus & { canResume: boolean } {
  return { available: status.remaining ?? Number(status.available), maximum: status.maximum ?? 1, nextPackAt: status.nextPackAt, canResume: status.pending.length > 0 };
}
