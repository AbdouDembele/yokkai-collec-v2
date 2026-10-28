"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Topbar } from "@/components/topbar";
import { Button, Karas, StatusPill, Toast } from "@/components/ui";
import { getGameInfo } from "@/lib/data/cards";
import {
  claimAchievement,
  getAchievements,
  type Achievement
} from "@/lib/data/achievements";
import { subscribePlayerSnapshotInvalidation } from "@/lib/data/player-state";

function progressText(item: Achievement) {
  const value = `${item.progressCurrent.toLocaleString("en-US")}/${item.progressTarget.toLocaleString("en-US")}`;
  const plural = item.progressTarget === 1 ? "" : "s";
  const suffix: Record<string, string> = {
    regular_packs_opened: `pack${plural} opened`,
    decision_packs_completed: `Decision Pack${plural} completed`,
    unique_cards_collected: `different card${plural}`,
    first_lr_card: `LR card${plural}`,
    shiny_cards_collected: `Shiny card${plural}`,
    auctions_won: `auction${plural} won`,
    trades_completed: `trade${plural} completed`,
    ssr_evolved_to_lr: `evolution${plural} completed`
  };
  if (item.conditionType === "cards_collected_category_percent")
    return `${value} card${plural}${item.progressLabel ? ` · ${item.progressLabel}` : ""}`;
  return `${value} ${suffix[item.conditionType] || ""}`.trim();
}

export function AchievementCard({
  item,
  busy = false,
  onClaim
}: {
  item: Achievement;
  busy?: boolean;
  onClaim: (item: Achievement) => Promise<void> | void;
}) {
  const state = item.claimedAt
    ? "claimed"
    : item.completedAt
      ? "completed"
      : "progress";
  const percent = Math.min(
    100,
    item.progressTarget ? (item.progressCurrent / item.progressTarget) * 100 : 0
  );
  return (
    <article id={item.id} className={`yk-achievement-card is-${state}`}>
      <header>
        <span className="yk-achievement-icon" aria-hidden="true">
          {state === "claimed" ? "✓" : state === "completed" ? "✦" : "◇"}
        </span>
        <div>
          <div className="yk-achievement-title">
            <h2>{item.title}</h2>
            <StatusPill
              tone={
                state === "claimed"
                  ? "success"
                  : state === "completed"
                    ? "gold"
                    : "info"
              }
            >
              {state === "claimed"
                ? "Claimed"
                : state === "completed"
                  ? "Ready to claim"
                  : "In progress"}
            </StatusPill>
          </div>
          <p>{item.description}</p>
        </div>
      </header>
      <div className="yk-achievement-progress">
        <div>
          <span>{progressText(item)}</span>
          <strong>{Math.round(percent)}%</strong>
        </div>
        <div
          className="yk-achievement-track"
          role="progressbar"
          aria-label={`Progress for ${item.title}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
        >
          <i
            style={
              { "--achievement-progress": `${percent}%` } as React.CSSProperties
            }
          />
        </div>
      </div>
      <footer>
        <span>
          Reward <Karas amount={item.karasReward} />
        </span>
        {state === "completed" ? (
          <Button disabled={busy} onClick={() => void onClaim(item)}>
            {busy
              ? "Claiming…"
              : `Claim ${item.karasReward.toLocaleString("en-US")} Karas`}
          </Button>
        ) : state === "claimed" ? (
          <StatusPill tone="success">Claimed</StatusPill>
        ) : (
          <span className="yk-achievement-pending">
            Remaining:{" "}
            {Math.max(
              0,
              item.progressTarget - item.progressCurrent
            ).toLocaleString("en-US")}
          </span>
        )}
      </footer>
    </article>
  );
}

export function AchievementsGallery({
  items,
  busyId,
  onClaim
}: {
  items: Achievement[];
  busyId?: string | null;
  onClaim: (item: Achievement) => Promise<void> | void;
}) {
  const unlocked = items.filter(item => item.completedAt).length;
  const percent = items.length ? (unlocked / items.length) * 100 : 0;
  return (
    <>
      <section className="yk-achievement-summary">
        <div>
          <p className="eyebrow">Overall progress</p>
          <p>
            <strong>
              {unlocked}/{items.length}
            </strong>{" "}
            achievements unlocked
          </p>
        </div>
        <div className="yk-achievement-global-track">
          <i
            style={
              { "--achievement-progress": `${percent}%` } as React.CSSProperties
            }
          />
        </div>
        <span>{Math.round(percent)}%</span>
      </section>
      <section aria-label="Achievements" className="yk-achievement-grid">
        {items.map(item => (
          <AchievementCard
            key={item.id}
            item={item}
            busy={busyId === item.id}
            onClaim={onClaim}
          />
        ))}
      </section>
    </>
  );
}

export function AchievementsPage({ account }: { account?: ReactNode }) {
  const [items, setItems] = useState<Achievement[]>([]);
  const [name, setName] = useState<string>();
  const [balance, setBalance] = useState<number>();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  useEffect(() => {
    let active = true;
    const unsubscribe = subscribePlayerSnapshotInvalidation(scopes => {
      if (scopes.includes("balance"))
        void getGameInfo().then(
          game => {
            if (active) setBalance(game.karasBalance);
          },
          () => undefined
        );
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    let active = true;
    Promise.all([getAchievements(), getGameInfo()]).then(
      ([achievements, game]) => {
        if (!active) return;
        setItems(achievements);
        setName(game.user.name);
        setBalance(game.karasBalance);
        setError("");
      },
      reason => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Couldn't load achievements."
          );
      }
    );
    return () => {
      active = false;
    };
  }, []);
  async function claim(item: Achievement) {
    if (busy) return;
    setBusy(item.id);
    setError("");
    try {
      const result = await claimAchievement(item.id);
      setBalance(result.balance);
      setItems(current =>
        current.map(entry =>
          entry.id === item.id
            ? { ...entry, claimedAt: result.claimedAt }
            : entry
        )
      );
      setToast(
        `Reward claimed: ${result.reward.toLocaleString("en-US")} Karas`
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Couldn't claim this reward."
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="w-full">
      <Topbar
        view="achievements"
        account={account}
        name={name}
        karas={balance}
      />
      <main id="main-content" className="mx-auto w-full max-w-6xl px-6 py-10">
        <p className="eyebrow">Your collecting journey</p>
        <h1 className="yk-title mt-3">Achievements</h1>
        <p className="mt-4 max-w-xl text-sm leading-6 text-ink-2">
          Open, collect, and trade. Reach each milestone to unlock a reward.
        </p>
        {error && (
          <p role="alert" className="yk-social-alert mt-6">
            {error}
          </p>
        )}
        {!items.length && !error ? (
          <p role="status" className="mt-10 text-sm text-ink-2">
            Loading achievements…
          </p>
        ) : (
          <AchievementsGallery items={items} busyId={busy} onClaim={claim} />
        )}
      </main>
      <Toast message={toast} onDismiss={() => setToast("")} />
    </div>
  );
}
