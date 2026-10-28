"use client";

import { useState } from "react";
import { CardCinematic } from "@/components/card-cinematic";
import { createLocalLrPack } from "@/lib/ui/local-lr-packs";
import "@/styles/lr-cinematic-preview.css";

export function CardCinematicsPreview() {
  const [variant, setVariant] = useState<"SSR" | "LR" | "LR Shiny">("LR");
  const [sequence, setSequence] = useState(0);
  const rarity = variant === "SSR" ? "SSR" : "LR";
  const cards = createLocalLrPack("regular", sequence);
  const card = {
    ...cards.find(card => card.rarity === rarity)!,
    shiny: variant === "LR Shiny"
  };
  return (
    <>
      <div
        className="mb-4 flex flex-wrap gap-2"
        role="group"
        aria-label="Cinematic rarity"
      >
        {(["SSR", "LR", "LR Shiny"] as const).map(value => (
          <button
            key={value}
            type="button"
            className={`yk-button ${variant === value ? "yk-button-primary" : "yk-button-secondary"}`}
            aria-pressed={variant === value}
            onClick={() => setVariant(value)}
          >
            {value} cinematic
          </button>
        ))}
      </div>
      <div className="yk-card-cinematic-demo">
        <CardCinematic
          key={`${variant}:${sequence}`}
          card={card}
          onContinue={() => setSequence(value => value + 1)}
        />
      </div>
    </>
  );
}
