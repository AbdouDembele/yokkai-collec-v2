"use client";

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
  const [kind, setKind] = useState<"collection" | "referrals">("collection");
  const navigation = (
    <div
      className="yk-leaderboard-kinds"
      role="group"
      aria-label="Leaderboard category"
    >
      <Button
        variant="secondary"
        aria-pressed={kind === "collection"}
        onClick={() => setKind("collection")}
      >
        Collection
      </Button>
      <Button
        variant="secondary"
        aria-pressed={kind === "referrals"}
        onClick={() => setKind("referrals")}
      >
        Referrals
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
