"use client";

import { useEffect, useState } from "react";
import { invalidatePlayerSnapshots } from "@/lib/data/cards";
import {
  subscribePlayerSnapshotInvalidation,
  type PlayerSnapshotScope
} from "@/lib/data/player-state";

const initial = {
  image: "image-personnalisee",
  bidBalance: 500,
  tradeCollection: 3,
  tradeBalance: 500,
  achievementBalance: 500,
  reveal: 2
};
type Context = "auction" | "bid" | "trade" | "achievement";

export function DirectInvalidationProof({
  disabled = false
}: {
  disabled?: boolean;
}) {
  const [state, setState] = useState(initial);
  const [context, setContext] = useState<Context>("auction");
  const [pending, setPending] = useState<PlayerSnapshotScope[]>();
  useEffect(
    () =>
      subscribePlayerSnapshotInvalidation(scopes => {
        setState(current => {
          if (context === "auction" && scopes.includes("collection"))
            return { ...current, image: "image-catalogue" };
          if (context === "bid" && scopes.includes("balance"))
            return { ...current, bidBalance: 450 };
          if (
            context === "trade" &&
            scopes.includes("collection") &&
            scopes.includes("balance")
          )
            return { ...current, tradeCollection: 4, tradeBalance: 475 };
          if (context === "achievement" && scopes.includes("balance"))
            return { ...current, achievementBalance: 600 };
          return current;
        });
      }),
    [context]
  );
  useEffect(() => {
    if (!pending) return;
    if (!disabled) invalidatePlayerSnapshots(pending);
  }, [disabled, pending]);
  function mutate(nextContext: Context, scopes: PlayerSnapshotScope[]) {
    setContext(nextContext);
    setPending(scopes);
  }
  return (
    <section
      className="yk-social-panel"
      data-proof-state={JSON.stringify(state)}
    >
      <h2 className="yk-section-title">Invalidations directes</h2>
      <p className="mt-3 text-sm text-ink-2">
        Image : {state.image} · Mise : {state.bidBalance} · Échange :{" "}
        {state.tradeCollection} cartes / {state.tradeBalance} Karas · Succès :{" "}
        {state.achievementBalance} Karas
      </p>
      <p className="mt-2 text-xs text-ink-3">
        Reveal en cours : carte {state.reveal} — cet état ne doit jamais
        changer.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          className="yk-button yk-button-secondary"
          onClick={() => mutate("auction", ["collection"])}
        >
          Mettre aux enchères
        </button>
        <button
          type="button"
          className="yk-button yk-button-secondary"
          onClick={() => mutate("bid", ["balance"])}
        >
          Placer une mise
        </button>
        <button
          type="button"
          className="yk-button yk-button-secondary"
          onClick={() => mutate("trade", ["collection", "balance"])}
        >
          Accepter l’échange
        </button>
        <button
          type="button"
          className="yk-button yk-button-secondary"
          onClick={() => mutate("achievement", ["balance"])}
        >
          Réclamer le succès
        </button>
      </div>
    </section>
  );
}
