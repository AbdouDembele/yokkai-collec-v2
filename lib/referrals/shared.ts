export type ReferralStatus = {
  code: string | null;
  verifiedReferrals: number;
  packsEarned: number;
  bonusPacks: number;
  rank?: ReferralRank | null;
};

export type ReferralRank = {
  verifiedReferrals: number;
  totalPlayers: number;
  position: number | null;
  topPercent: number | null;
};

export type ReferredPlayer = {
  id: string;
  pseudo: string;
  avatarUrl: string | null;
  accountCreatedAt: string | null;
  referredAt: string;
  verifiedAt: string | null;
  boostersOpened: number | null;
};

export type ReferralPage = {
  referrals: ReferredPlayer[];
  total: number;
  offset: number;
  limit: number;
};
