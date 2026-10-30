"use client";
import { useTranslations } from "next-intl";

import { useState } from "react";
import { Button } from "@/components/ui";
import { CollectionLeaderboardView } from "@/components/collection-leaderboard";
import { CommunityLeaderboardView } from "@/components/community-leaderboard";
import { ReferralLeaderboardView } from "@/components/referral-leaderboard";

export function LeaderboardsView({
  userId,
  embedded = false
}: {
  userId: string;
  embedded?: boolean;
}) {
  const tPr4 = useTranslations();
  const [kind, setKind] = useState<
    "collection" | "referrals" | "likes" | "licenses"
  >("collection");
  const navigation = (
    <div
      className="yk-leaderboard-kinds"
      role="group"
      aria-label={tPr4("socialUi.leaderboardCategory")}
    >
      <Button
        variant="secondary"
        aria-pressed={kind === "collection"}
        onClick={() => setKind("collection")}
      >
        {tPr4("communityRanking.powerRankingTab")}
      </Button>
      {(["likes", "licenses"] as const).map(option => (
        <Button
          key={option}
          variant="secondary"
          aria-pressed={kind === option}
          onClick={() => setKind(option)}
        >
          {tPr4(`communityRanking.${option}Tab`)}
        </Button>
      ))}
      <Button
        variant="secondary"
        aria-pressed={kind === "referrals"}
        onClick={() => setKind("referrals")}
      >
        {tPr4("socialUi.referrals")}
      </Button>
    </div>
  );
  if (kind === "likes" || kind === "licenses")
    return (
      <CommunityLeaderboardView
        key={kind}
        kind={kind}
        userId={userId}
        embedded={embedded}
        navigation={navigation}
      />
    );
  return kind === "collection" ? (
    <CollectionLeaderboardView
      userId={userId}
      embedded={embedded}
      navigation={navigation}
    />
  ) : (
    <ReferralLeaderboardView
      userId={userId}
      embedded={embedded}
      navigation={navigation}
    />
  );
}
