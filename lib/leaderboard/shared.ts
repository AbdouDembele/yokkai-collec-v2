import type { PlayerCosmetics } from "@/components/styled-player-name";

export type CollectionRankEntry = {
  userId: string;
  pseudo: string;
  avatarUrl: string | null;
  position: number;
  score: number;
  uniqueVariants: number;
  infinityVariants: number;
  shinyVariants: number;
  isFriend: boolean;
};

export type ScoreBreakdown = {
  rarity: string;
  variant: "standard" | "infinity" | "shiny";
  points: number;
  uniqueVariants: number;
  copies: number;
  duplicatePoints: number;
};

export type ReferralLeaderboard = {
  profileStyles?: Record<string, PlayerCosmetics>;
  offset: number;
  limit: number;
  query: string;
  friendsOnly: boolean;
  topLimit: number;
  total: number;
  rankedPlayers: number;
  entries: {
    userId: string;
    pseudo: string;
    avatarUrl: string | null;
    position: number;
    verifiedReferrals: number;
    isFriend: boolean;
  }[];
  mine: {
    verifiedReferrals: number;
    isPublic: boolean;
    position: number | null;
  };
};

export type CollectionLeaderboard = {
  history?: import("./progress").RankHistory;
  cardCounts?: Record<string, LeaderboardCardCounts>;
  profileStyles?: Record<string, PlayerCosmetics>;
  rulesVersion: number;
  offset: number;
  limit: number;
  total: number;
  rankedPlayers: number;
  query: string;
  friendsOnly: boolean;
  topLimit: number;
  entries: CollectionRankEntry[];
  mine: Omit<
    CollectionRankEntry,
    "userId" | "pseudo" | "avatarUrl" | "position" | "isFriend"
  > & {
    position: number | null;
    isPublic: boolean;
    breakdown: ScoreBreakdown[];
  };
};

export type LeaderboardCardCounts = {
  sr: number;
  ssr: number;
  lr: number;
  infinity: number;
  shiny: number;
};

// Explanatory values only. The database calculates and ranks the real holdings.
export const COLLECTION_SCORE_RULES = [
  { label: "C", points: 5, kind: "standard" },
  { label: "R", points: 25, kind: "standard" },
  { label: "SR", points: 100, kind: "standard" },
  { label: "SSR", points: 1000, kind: "ssr" },
  { label: "LR", points: 5000, kind: "lr" },
  { label: "SSR Infinity", points: 6000, kind: "infinity" },
  { label: "LR Infinity", points: 18000, kind: "infinity" },
  { label: "LR Shiny", points: 50000, kind: "shiny" }
] as const;
