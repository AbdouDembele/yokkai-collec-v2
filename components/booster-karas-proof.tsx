"use client";

import { useState } from "react";
import { BoosterReveal, type RevealCard } from "@/components/boosters";
import type { CollectedCard } from "@/lib/data/cards";

const base = (
  id: string,
  name: string,
  rarity: RevealCard["rarity"],
  destructionValue: number
): RevealCard & CollectedCard => ({
  id: `card-${id}`,
  instanceId: id,
  name,
  category: "Yokai",
  anime: "Spirit Realm",
  rarity,
  image: "/assets/booster-pack.png",
  destructionValue,
  obtainedAt: "2026-10-06T12:00:00Z",
  shiny: false,
  isEvolved: false,
  isFirstOwner: true,
  folderId: null,
  catalogueImage: "/assets/booster-pack.png",
  customImageUrl: null
});
const regular = [
  base("regular-c", "Kumo", "C", 1),
  base("regular-r", "Aoi", "R", 2),
  base("regular-sr", "Kuro", "SR", 3),
  base("regular-ssr", "Ren", "SSR", 4),
  base("regular-lr", "Yuki", "LR", 5)
];
const decision = [
  base("decision-1", "Kitsune", "SR", 3),
  base("decision-2", "Oni", "SR", 3),
  base("decision-3", "Dragon", "SSR", 4),
  base("decision-4", "Hikari", "LR", 5),
  base("decision-5", "Mochi", "SR", 3)
];

export function BoosterKarasProof({
  disabled = false
}: {
  disabled?: boolean;
}) {
  const cards = (items: RevealCard[]) =>
    disabled
      ? items.map(card => ({ ...card, destructionValue: undefined }))
      : items;
  const [balance, setBalance] = useState(0);
  const [owned, setOwned] = useState(
    () => new Set(regular.map(card => card.instanceId))
  );
  const [completed, setCompleted] = useState(false);
  const [returned, setReturned] = useState(false);
  async function discard(instanceId: string) {
    const card = regular.find(item => item.instanceId === instanceId);
    if (!card) return;
    setOwned(current => {
      const next = new Set(current);
      next.delete(instanceId);
      return next;
    });
    setBalance(current => current + card.destructionValue!);
  }
  return (
    <div
      className="flex flex-col gap-12"
      data-proof-mode={disabled ? "counterproof" : "enabled"}
    >
      <section data-proof="regular">
        <div className={`yk-feedback ${disabled ? "" : "yk-feedback-success"}`}>
          <strong>Regular Pack · sélection multiple</strong>
          <span>
            {disabled
              ? "Contre-preuve : valeur serveur absente"
              : "Valeurs serveur présentes avant destruction groupée"}
          </span>
        </div>
        <div
          className="mt-3 text-sm text-ink-2"
          data-proof-audit
          data-balance={balance}
          data-owned={[...owned].join(",")}
          data-completed={completed}
          data-returned={returned}
        >
          Crédit : {balance} Karas · collection finale : {[...owned].join(", ")}
          {returned ? " · retour /boosters" : ""}
        </div>
        <BoosterReveal
          cards={cards(regular)}
          collection={cards(regular) as CollectedCard[]}
          folders={[]}
          revealed={5}
          onReveal={() => {}}
          onReturn={() => setReturned(true)}
          onDiscard={discard}
          onAuction={async () => {}}
          onMoveCard={async () => {}}
          onSetLocked={async () => {}}
          onEvolve={async () => cards(regular)[0] as CollectedCard}
          onSetCustomImage={async () => {}}
          onComplete={() => setCompleted(true)}
        />
      </section>
      <section data-proof="decision">
        <div className={`yk-feedback ${disabled ? "" : "yk-feedback-success"}`}>
          <strong>3b · Choix Decision Pack</strong>
          <span>
            {disabled
              ? "Contre-preuve : valeurs serveur absentes"
              : "Total des quatre cartes perdues présent avant validation"}
          </span>
        </div>
        <BoosterReveal
          cards={cards(decision)}
          revealed={5}
          onReveal={() => {}}
          onReturn={() => {}}
          decision={{ onKeep: async () => 15 }}
        />
      </section>
    </div>
  );
}
