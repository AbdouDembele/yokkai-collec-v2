"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Topbar } from "@/components/topbar";
import { getGameInfo } from "@/lib/data/cards";
import { subscribePlayerSnapshotInvalidation } from "@/lib/data/player-state";

export function LeaderboardTopbar({ account }: { account?: ReactNode }) {
  const [karas, setKaras] = useState<number>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let request = 0;
    const refresh = async () => {
      const current = ++request;
      try {
        const info = await getGameInfo();
        if (active && current === request) {
          setKaras(info.karasBalance);
          setError(undefined);
        }
      } catch {
        if (active && current === request)
          setError("Couldn't load your balance. Please try again.");
      }
    };
    void refresh();
    const unsubscribe = subscribePlayerSnapshotInvalidation(scopes => {
      if (scopes.includes("balance")) void refresh();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [attempt]);

  return (
    <Topbar
      view="leaderboard"
      account={account}
      karas={karas}
      infoError={error}
      onRetryInfo={() => {
        setError(undefined);
        setAttempt(value => value + 1);
      }}
    />
  );
}
