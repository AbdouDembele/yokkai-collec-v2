"use client";
import { useTranslations } from "next-intl";

import { useState } from "react";
import { Button } from "@/components/ui";
import { CollectionLeaderboardView } from "@/components/collection-leaderboard";
import { ReferralLeaderboardView } from "@/components/referral-leaderboard";

export function LeaderboardsView({
  userId,
  embedded = false
}: {
  userId: string;
  embedded?: boolean;
}) {
  const tPr4 = useTranslations();
  const [kind, setKind] = useState<"collection" | "referrals">("collection");
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
        {tPr4("collectionUi.collection")}
      </Button>
      <Button
        variant="secondary"
        aria-pressed={kind === "referrals"}
        onClick={() => setKind("referrals")}
      >
        {tPr4("socialUi.referrals")}
      </Button>
    </div>
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
