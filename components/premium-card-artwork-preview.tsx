"use client";

import { useState, useSyncExternalStore } from "react";
import { YokaiCard } from "@/components/yokai-card";
import { PREMIUM_CARD_ARTWORK_EXAMPLE as example } from "@/lib/premium/card-artwork-example";

function subscribeMotionPreference(onChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const serverMotionPreference = () => true;

export function PremiumCardArtworkPreview() {
  const reducedMotion = useSyncExternalStore(
    subscribeMotionPreference,
    prefersReducedMotion,
    serverMotionPreference
  );
  const [playbackOverride, setPlaybackOverride] = useState<boolean | null>(
    null
  );
  const playing = playbackOverride ?? !reducedMotion;
  return (
    <section
      className="yk-pro-artwork-showcase"
      aria-labelledby="artwork-preview-title"
    >
      <div className="yk-pro-banner-copy">
        <p className="eyebrow">Custom card artwork</p>
        <h2 id="artwork-preview-title">
          Your cards.
          <br />
          <em>Your own artwork.</em>
        </h2>
        <p>
          Same character. Same rarity. A different look. Give your favorite card
          a personal touch with an image or animated GIF.
        </p>
        <div className="yk-pro-banner-caption">
          <span aria-hidden="true">✦</span> Your collection, reimagined
        </div>
        <p className="yk-pro-banner-disclaimer">
          Express your style with a new illustration while keeping your card’s
          identity and rarity.
        </p>
      </div>
      <div className="yk-pro-artwork-preview">
        <div className="yk-pro-artwork-pair">
          <figure className="yk-pro-artwork-original">
            <figcaption>Original artwork</figcaption>
            <YokaiCard {...example.card} animated={false} />
          </figure>
          <span className="yk-pro-artwork-arrow" aria-hidden="true">
            →
          </span>
          <figure className="yk-pro-artwork-custom">
            <figcaption>
              Custom artwork <span>GIF</span>
            </figcaption>
            <button
              type="button"
              className="yk-pro-custom-card-toggle"
              aria-label={`${playing ? "Pause" : "Play"} Satoru Gojo's custom artwork animation`}
              aria-pressed={playing}
              onClick={() => setPlaybackOverride(!playing)}
            >
              <YokaiCard
                {...example.card}
                image={playing ? example.customGif : example.still}
                fallbackImage={example.card.image}
                animated={false}
              />
            </button>
          </figure>
        </div>
        <p className="yk-pro-artwork-caption">
          Same LR card. Only the illustration changes.
        </p>
      </div>
    </section>
  );
}
