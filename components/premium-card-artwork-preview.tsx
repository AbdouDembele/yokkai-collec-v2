"use client";
import { useTranslations } from "next-intl";

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
  const tPr5 = useTranslations("premiumUi");
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
        <p className="eyebrow">{tPr5("customCardArtwork")}</p>
        <h2 id="artwork-preview-title">
          {tPr5.rich("yourCardsYourOwnArtwork", {
            br0: () => <br />,
            em1: chunks => <em>{chunks}</em>
          })}
        </h2>
        <p>{tPr5("sameCharacterSameRarityADifferentLook")}</p>
        <div className="yk-pro-banner-caption">
          <span aria-hidden="true">✦</span> {tPr5("yourCollectionReimagined")}
        </div>
        <p className="yk-pro-banner-disclaimer">
          {tPr5("expressYourStyleWithANewIllustration")}
        </p>
      </div>
      <div className="yk-pro-artwork-preview">
        <div className="yk-pro-artwork-pair">
          <figure className="yk-pro-artwork-original">
            <figcaption>{tPr5("originalArtwork")}</figcaption>
            <YokaiCard {...example.card} animated={false} />
          </figure>
          <span className="yk-pro-artwork-arrow" aria-hidden="true">
            →
          </span>
          <figure className="yk-pro-artwork-custom">
            <figcaption>
              {tPr5.rich("customArtworkGIF", {
                span0: chunks => <span>{chunks}</span>
              })}
            </figcaption>
            <button
              type="button"
              className="yk-pro-custom-card-toggle"
              aria-label={tPr5("artworkPlayback", {
                action: playing ? "pause" : "play",
                name: "Satoru Gojo"
              })}
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
          {tPr5("sameLRCardOnlyTheIllustrationChanges")}
        </p>
      </div>
    </section>
  );
}
