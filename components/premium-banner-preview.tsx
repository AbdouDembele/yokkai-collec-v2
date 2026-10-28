"use client";

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
        <p className="eyebrow">Animated banners</p>
        <h2 id="banner-preview-title">
          Your profile.
          <br />
          <em>With a little motion.</em>
        </h2>
        <p>
          Your favorite moment, on repeat. Make your banner your own with an
          image or an animated GIF.
        </p>
        <div className="yk-pro-banner-caption">
          <span aria-hidden="true">✦</span> A profile that feels like you
        </div>
        <p className="yk-pro-banner-disclaimer">
          Set the mood with your favorite image or bring it to life with an
          animated GIF.
        </p>
      </div>
      <div className="yk-pro-banner-example">
        <div className="yk-pro-banner-card">
          <button
            type="button"
            className="yk-pro-live-banner"
            aria-label={`${playing ? "Pause GIF" : "Play GIF"}: ${example.name}'s profile banner`}
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
                {playing ? "ANIMATED BANNER" : "STATIC IMAGE"}
              </span>
            )}
            {failed && (
              <span className="yk-pro-banner-error" role="status">
                Banner preview unavailable.
              </span>
            )}
          </button>
          <div className="yk-pro-banner-card-body">
            <Image
              src={example.avatar}
              alt={`${example.name}'s avatar`}
              width={78}
              height={78}
              className="yk-pro-banner-avatar"
            />
            <div className="yk-pro-banner-name">
              <h3>{example.name}</h3>
              <span>YOKKAI PRO</span>
            </div>
            <p>A banner that makes your profile feel alive.</p>
          </div>
        </div>
        <div className="yk-pro-banner-controls">
          <span>Your profile. Your signature.</span>
        </div>
      </div>
    </section>
  );
}
