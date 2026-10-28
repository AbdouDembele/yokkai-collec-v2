"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { YokaiCard } from "@/components/yokai-card";
import { StyledPlayerName } from "@/components/styled-player-name";
import { bannerGeometry } from "@/lib/ui/banner-frame";
import {
  normalizeProfileStyle,
  type ProfileStyle
} from "@/lib/ui/profile-style";
import type { Rarity } from "@/lib/data/cards";
import profile from "@/lib/premium/profile-example.json";

function subscribeMotion(onChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const serverMotion = () => true;
const style = normalizeProfileStyle(profile.style as ProfileStyle);
const geometry = bannerGeometry(498 / 281, profile.bannerFrame);

export function PremiumProfileEmbed() {
  const reduce = useSyncExternalStore(
    subscribeMotion,
    reducedMotion,
    serverMotion
  );
  const [override, setOverride] = useState<boolean | null>(null);
  const [bannerFailed, setBannerFailed] = useState(false);
  const playing = override ?? !reduce;
  return (
    <div
      className="yk-pro-native-profile"
      aria-label="BBDOU's customized profile preview"
      data-playing={playing}
    >
      <aside className="yk-pro-native-identity">
        <div className="yk-pro-native-banner">
          <Image
            src={
              playing && !bannerFailed ? profile.banner : profile.bannerStill
            }
            alt="BBDOU's anime profile banner"
            fill
            unoptimized
            sizes="(max-width: 760px) 100vw, 340px"
            style={{
              transform: `translate(${geometry.offsetX}%, ${geometry.offsetY}%) scale(${geometry.scale}) rotate(${geometry.rotation}deg)`
            }}
            onError={() => setBannerFailed(true)}
          />
        </div>
        <div className="yk-pro-native-avatar" data-frame={style.avatarFrame}>
          <Image
            src={profile.avatar}
            alt="BBDOU's avatar"
            width={88}
            height={88}
          />
        </div>
        <div className="yk-pro-native-about">
          <p className="eyebrow">Collector</p>
          <h3>
            <StyledPlayerName
              name={profile.pseudo}
              cosmetics={{ active: true, style }}
            />
          </h3>
          <p>A collection with a signature.</p>
          <Link href="/profile/BBDOU">
            View BBDOU&apos;s profile <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <div className="yk-pro-native-signature">
          <p className="eyebrow">Made personal with Pro</p>
          <ul>
            <li>
              <span className="yk-pro-native-colors" aria-hidden="true">
                <i style={{ backgroundColor: style.color }} />
                <i style={{ backgroundColor: style.secondary }} />
                <i style={{ backgroundColor: "#9ccaff" }} />
              </span>
              <div>
                <strong>Your colors.</strong>
                <p>Custom name fonts and effects.</p>
              </div>
            </li>
            <li>
              <span className="yk-pro-native-detail-icon" aria-hidden="true">
                ✦
              </span>
              <div>
                <strong>Your finishing touches.</strong>
                <p>Avatar frames and decorative badges.</p>
              </div>
            </li>
            <li>
              <span className="yk-pro-native-detail-icon" aria-hidden="true">
                {profile.cards.length}
              </span>
              <div>
                <strong>Your favorite cards.</strong>
                <p>A bigger showcase, in your own style.</p>
              </div>
            </li>
          </ul>
        </div>
      </aside>
      <section
        className="yk-pro-native-showcase"
        aria-labelledby="bbdou-showcase-title"
      >
        <header>
          <div>
            <p className="eyebrow">BBDOU&apos;s showcase</p>
            <h3 id="bbdou-showcase-title">Featured cards</h3>
          </div>
          <button
            type="button"
            aria-pressed={playing}
            aria-label={`${playing ? "Pause" : "Play"} BBDOU's banner and showcase animations`}
            onClick={() => setOverride(!playing)}
          >
            <span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span>
            {playing ? "Pause animations" : "Play animations"}
          </button>
        </header>
        <ul className="yk-pro-native-cards">
          {profile.cards.map(card => (
            <li key={card.name}>
              <YokaiCard
                name={card.name}
                category={card.category}
                anime={card.anime}
                rarity={card.rarity as Rarity}
                shiny={card.shiny}
                image={playing && card.animated ? card.animated : card.still}
                fallbackImage={card.still}
                animated={playing}
              />
            </li>
          ))}
        </ul>
        <p className="yk-pro-native-caption">
          Real custom artwork from BBDOU&apos;s showcase. Your cards, your
          style.
        </p>
      </section>
    </div>
  );
}
