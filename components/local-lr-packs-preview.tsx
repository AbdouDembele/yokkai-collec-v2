"use client";

import { useState } from "react";
import { Boosters, type RevealCard } from "@/components/boosters";
import { createLocalLrPack } from "@/lib/ui/local-lr-packs";
import { useSfx } from "@/hooks/use-sfx";
import type { CollectedCard } from "@/lib/data/cards";

export function LocalLrPacksPreview() {
  const [draw, setDraw] = useState<RevealCard[]>([]);
  const [kind, setKind] = useState<"regular" | "decision">("regular");
  const [revealed, setRevealed] = useState(0);
  const [sequence, setSequence] = useState(0);
  const [collection, setCollection] = useState<CollectedCard[]>([]);
  const [balance, setBalance] = useState(0);
  const [listed, setListed] = useState<string[]>([]);
  const sound = useSfx();

  function remember(cards: RevealCard[]) {
    const owned = cards.map(card => ({
      ...card,
      obtainedAt: new Date().toISOString(),
      shiny: false,
      isEvolved: false,
      isFirstOwner: true,
      folderId: null,
      catalogueImage: card.image,
      customImageUrl: null,
      destructionValue: { C: 1, R: 2, SR: 4, SSR: 10, LR: 25 }[card.rarity]
    }));
    setCollection(current => [...current, ...owned]);
    return owned;
  }
  function assertAvailable(id: string) {
    const card = collection.find(item => item.instanceId === id);
    if (!card) throw new Error("This demo card is no longer available.");
    if (card.locked || listed.includes(id))
      throw new Error("Unlock this card or choose a card that isn't listed.");
    return card;
  }
  function update(id: string, patch: Partial<CollectedCard & RevealCard>) {
    setCollection(current =>
      current.map(card =>
        card.instanceId === id ? { ...card, ...patch } : card
      )
    );
    setDraw(current =>
      current.map(card =>
        card.instanceId === id ? { ...card, ...patch } : card
      )
    );
  }

  if (process.env.NODE_ENV !== "development") return null;
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-veil bg-veil px-4 py-3 text-sm">
        <p role="status">
          Unlimited demo packs · LR guaranteed in slot 5 · No real rewards ·
          Demo Karas: {balance.toLocaleString("en-US")}
        </p>
        <button
          type="button"
          className="yk-button yk-button-secondary"
          aria-pressed={sound.enabled}
          onClick={sound.toggle}
        >
          {sound.enabled ? "Mute sounds" : "Enable sounds"}
        </button>
      </div>
      <Boosters
        previewOnly
        clickToOpen
        simulateActions
        onOpenMany={async count => {
          const cards = remember(
            Array.from({ length: count }, (_, index) =>
              createLocalLrPack("regular", sequence + index)
            ).flat()
          );
          setSequence(current => current + count);
          setKind("regular");
          setRevealed(0);
          setDraw(cards);
          return cards;
        }}
        status={{ available: 10, reserve: 10, maximum: 10, nextPackAt: null }}
        countdown="00:00"
        decisionStatus={{
          available: true,
          pending: [],
          remaining: 2,
          maximum: 2,
          nextPackAt: 4_102_444_800_000
        }}
        decisionCountdown="00:00"
        busy={false}
        draw={draw}
        drawKind={kind}
        collection={collection}
        folders={[{ id: "demo-favorites", name: "Favorites" }]}
        revealed={revealed}
        onOpen={async nextKind => {
          const cards = remember(createLocalLrPack(nextKind, sequence));
          setSequence(current => current + 1);
          setKind(nextKind);
          setRevealed(0);
          setDraw(cards);
          return cards;
        }}
        onKeepDecision={async () => 0}
        onSellDecisionAll={async () => {
          const reward = draw.reduce(
            (sum, card) => sum + (card.destructionValue ?? 0),
            0
          );
          const ids = new Set(draw.map(card => card.instanceId));
          setBalance(current => current + reward);
          setCollection(current =>
            current.filter(card => !ids.has(card.instanceId))
          );
          return reward;
        }}
        onDiscard={async id => {
          const card = assertAvailable(id);
          setBalance(current => current + (card.destructionValue ?? 0));
          setCollection(current =>
            current.filter(item => item.instanceId !== id)
          );
          update(id, { discarded: true });
        }}
        onAuction={async (id, price, duration) => {
          assertAvailable(id);
          if (
            !Number.isSafeInteger(price) ||
            price < 10 ||
            ![15, 30, 60, 240, 720, 1440].includes(duration)
          )
            throw new Error("Choose a valid price and auction duration.");
          setListed(current => [...current, id]);
        }}
        onSetLocked={async (id, locked) => {
          if (listed.includes(id)) throw new Error("This demo card is listed.");
          update(id, { locked });
        }}
        onMoveCard={async (id, folderId) => update(id, { folderId })}
        onSetCustomImage={async (id, imageUrl) => {
          const card = collection.find(item => item.instanceId === id);
          if (card)
            update(id, {
              customImageUrl: imageUrl,
              image: imageUrl || card.catalogueImage
            });
        }}
        onEvolve={async ids => {
          const copies = ids.map(assertAvailable);
          if (
            new Set(ids).size !== 5 ||
            copies.some(
              card =>
                card.id !== copies[0].id || card.rarity !== "SSR" || card.shiny
            )
          )
            throw new Error("Choose five identical SSR copies.");
          const evolved = {
            ...copies[0],
            instanceId: `${copies[0].instanceId}-evolved`,
            shiny: true,
            isEvolved: true
          };
          setCollection(current => [
            ...current.filter(card => !ids.includes(card.instanceId)),
            evolved
          ]);
          setDraw(current =>
            current.map(card =>
              ids.includes(card.instanceId)
                ? { ...card, discarded: true }
                : card
            )
          );
          return evolved;
        }}
        onReveal={index =>
          setRevealed(current => (current === index ? current + 1 : current))
        }
        onSound={sound.play}
        onStopSound={sound.stopCardSounds}
      />
    </>
  );
}
