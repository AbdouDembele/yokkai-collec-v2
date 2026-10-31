"use client";
import { useTranslations } from "next-intl";

import Image from "next/image";
import { useState, useSyncExternalStore } from "react";
import { PREMIUM_BANNER_EXAMPLE as example } from "@/lib/premium/banner-example";
import { bannerGeometry } from "@/lib/ui/banner-frame";

function subscribeMotionPreference(onChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const serverMotionPreference = () => true;

export function PremiumBannerPreview() {
  const tPr5 = useTranslations("premiumUi");
  const reducedMotion = useSyncExternalStore(
    subscribeMotionPreference,
    prefersReducedMotion,
    serverMotionPreference
  );
  const [playbackOverride, setPlaybackOverride] = useState<boolean | null>(
    null
  );
  const [failed, setFailed] = useState(false);
  const playing = playbackOverride ?? !reducedMotion;
  const geometry = bannerGeometry(498 / 281, example.frame);
  return (
    <section
      className="yk-pro-banner-showcase"
      aria-labelledby="banner-preview-title"
    >
      <div className="yk-pro-banner-copy">
        <p className="eyebrow">{tPr5("animatedBanners")}</p>
        <h2 id="banner-preview-title">
          {tPr5.rich("yourProfileWithALittleMotion", {
            br0: () => <br />,
            em1: chunks => <em>{chunks}</em>
          })}
        </h2>
        <p>{tPr5("yourFavoriteMomentOnRepeatMakeYour")}</p>
        <div className="yk-pro-banner-caption">
          <span aria-hidden="true">✦</span> {tPr5("aProfileThatFeelsLikeYou")}
        </div>
        <p className="yk-pro-banner-disclaimer">
          {tPr5("setTheMoodWithYourFavoriteImage")}
        </p>
      </div>
      <div className="yk-pro-banner-example">
        <div className="yk-pro-banner-card">
          <button
            type="button"
            className="yk-pro-live-banner"
            aria-label={tPr5("bannerPlayback", {
              action: playing ? "pause" : "play",
              name: example.name
            })}
            aria-pressed={playing}
            onClick={() => setPlaybackOverride(!playing)}
          >
            <Image
              src={playing ? example.animated : example.still}
              alt=""
              fill
              unoptimized
              sizes="(max-width: 600px) calc(100vw - 40px), 620px"
              className="yk-pro-banner-image"
              draggable={false}
              style={{
                transform: `translate(${geometry.offsetX}%, ${geometry.offsetY}%) scale(${geometry.scale}) rotate(${geometry.rotation}deg)`
              }}
              onError={() => setFailed(true)}
              onLoad={() => setFailed(false)}
            />
            {!failed && (
              <span className="yk-pro-gif-label" aria-hidden="true">
                {playing ? tPr5("animatedBanner") : tPr5("staticImage")}
              </span>
            )}
            {failed && (
              <span className="yk-pro-banner-error" role="status">
                {tPr5("bannerPreviewUnavailable")}
              </span>
            )}
          </button>
          <div className="yk-pro-banner-card-body">
            <Image
              src={example.avatar}
              alt={tPr5("avatar", { name: example.name })}
              width={78}
              height={78}
              className="yk-pro-banner-avatar"
            />
            <div className="yk-pro-banner-name">
              <h3>{example.name}</h3>
              <span>YOKKAI PRO</span>
            </div>
            <p>{tPr5("aBannerThatMakesYourProfileFeel")}</p>
          </div>
        </div>
        <div className="yk-pro-banner-controls">
          <span>{tPr5("yourProfileYourSignature2")}</span>
        </div>
      </div>
    </section>
  );
}
