"use client";

import Image from "next/image";
import { useState, useSyncExternalStore } from "react";

function subscribeMotionPreference(onChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const serverMotionPreference = () => true;

// Read-only media snapshot of BBDOU's production showcase, requested by its owner.
// Slots 2 and 3 are static in production and remain visible in the photograph.
const animatedCards = [1, 4, 5, 6, 7, 8, 9, 10] as const;

export function PremiumProfileMotion() {
  const reducedMotion = useSyncExternalStore(
    subscribeMotionPreference,
    prefersReducedMotion,
    serverMotionPreference
  );
  const [playbackOverride, setPlaybackOverride] = useState<boolean | null>(
    null
  );
  const [failedMedia, setFailedMedia] = useState<string[]>([]);
  const playing = playbackOverride ?? !reducedMotion;
  const media = [
    {
      key: "banner",
      src: "/assets/premium-examples/bbdou-live-banner.gif",
      style: {
        left: "0%",
        top: "0.574713%",
        width: "31.609195%",
        height: "27.298851%"
      }
    },
    ...animatedCards.map(slot => ({
      key: `card-${slot}`,
      src: `/assets/premium-examples/bbdou-showcase-${slot}.gif`,
      style: {
        left: `${((500 + ((slot - 1) % 5) * 175) / 1392) * 100}%`,
        top: `${((slot <= 5 ? 197 : 435) / 696) * 100}%`,
        width: `${(160 / 1392) * 100}%`,
        height: `${(224 / 696) * 100}%`
      }
    }))
  ];
  return (
    <div className="yk-pro-profile-motion">
      {playing &&
        media
          .filter(item => !failedMedia.includes(item.key))
          .map(item => (
            <div
              key={item.key}
              className={`yk-pro-profile-motion-media ${item.key === "banner" ? "is-banner" : "is-card"}`}
              style={item.style}
              aria-hidden="true"
            >
              <Image
                src={item.src}
                alt=""
                fill
                unoptimized
                sizes={item.key === "banner" ? "400px" : "160px"}
                onError={() =>
                  setFailedMedia(previous => [...previous, item.key])
                }
              />
            </div>
          ))}
      <button
        type="button"
        className="yk-pro-profile-motion-toggle"
        aria-label={`${playing ? "Pause" : "Play"} BBDOU's banner and showcase animations`}
        aria-pressed={playing}
        onClick={() => setPlaybackOverride(!playing)}
      >
        <span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span>
        {playing ? "Pause animations" : "Play animations"}
      </button>
    </div>
  );
}
