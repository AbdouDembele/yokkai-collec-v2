"use client";

import { useTranslations } from "next-intl";

import { cardRarityLabel } from "@/lib/ui/card-rarity-label";
import type { CSSProperties, ReactNode, SyntheticEvent } from "react";
import type { Rarity } from "@/lib/data/cards";
import "@/styles/cards.css";

export type YokaiCardProps = {
  rarity: Rarity;
  shiny?: boolean;
  isEvolved?: boolean;
  name: string;
  image?: string;
  category: string;
  anime?: string;
  number?: string | number;
  animated?: boolean;
  className?: string;
  fallbackImage?: string;
  catalogueImage?: string;
  imageSizes?: string;
  imageLoading?: "lazy" | "eager";
  categoryAccessory?: ReactNode;
  rarityAccessory?: ReactNode;
};
const spots = [
  [12, 18],
  [78, 26],
  [20, 62],
  [70, 58],
  [48, 14],
  [84, 46],
  [8, 40],
  [58, 70]
];

export function YokaiCard({
  rarity,
  shiny = false,
  isEvolved = false,
  name,
  image,
  category,
  anime,
  animated = true,
  imageLoading = "lazy",
  className = "",
  fallbackImage,
  catalogueImage,
  categoryAccessory,
  rarityAccessory
}: YokaiCardProps) {
  const t = useTranslations("collectionShared");
  const holo = shiny && (rarity === "SSR" || rarity === "LR");
  const evolved =
    (isEvolved || (shiny && rarity === "SSR")) &&
    (rarity === "SSR" || rarity === "LR");
  const special = holo || evolved;
  const franchise = anime?.trim();
  const sparkCount = !animated
    ? 0
    : evolved
      ? 6
      : holo
        ? 8
        : rarity === "LR"
          ? 4
          : rarity === "SSR"
            ? 3
            : 0;
  const artProps = {
    src: image ?? "",
    width: 300,
    height: 420,
    loading: imageLoading,
    decoding: "async" as const,
    onError: (event: SyntheticEvent<HTMLImageElement>) => {
      const fallback = fallbackImage ?? catalogueImage;
      if (fallback && event.currentTarget.src !== fallback) {
        event.currentTarget.removeAttribute("srcset");
        event.currentTarget.src = fallback;
      }
    }
  };
  return (
    <div
      className={`yk-card yk-rarity-${rarity} ${evolved ? "yk-evolved" : holo ? "yk-shiny" : ""} ${animated ? "yk-animated" : ""} ${className}`}
    >
      <div
        className="yk-card-clip"
        role="img"
        aria-label={`${name}, ${cardRarityLabel(rarity, shiny, isEvolved)}, ${franchise || category}`}
      >
        <div className="yk-card-frame" />
        {special && <div className="yk-shiny-frame" />}
        <div className="yk-card-interior">
          {rarity === "LR" && <div className="yk-card-line" />}
          {image && (
            <div className="yk-card-art">
              {/* Grids and details use the same original bytes for every source. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img {...artProps} alt="" />
            </div>
          )}
          <div className="yk-card-foil" />
          {special && <div className="yk-holo" />}
          {evolved && (
            <div className="yk-evolved-energy" aria-hidden="true">
              <span className="yk-evolved-scan" />
            </div>
          )}
          {spots.slice(0, sparkCount).map(([left, top], i) => (
            <span
              className={`yk-sparkle${evolved ? " yk-evolved-spark" : ""}`}
              key={i}
              style={
                {
                  left: `${left}%`,
                  top: `${top}%`,
                  fontSize: i % 3 === 0 ? "9cqw" : "6cqw",
                  animationDelay: `${i * 0.37}s`
                } as CSSProperties
              }
            >
              ✦
            </span>
          ))}
          <div className="yk-card-content">
            <div className="yk-card-top">
              <span className="yk-card-category" title={category}>
                {category}
              </span>
              <span className="yk-card-badges">
                <span className="yk-card-badge">{rarity}</span>
                {special && (
                  <span
                    className={`yk-shiny-badge${evolved ? " yk-evolved-badge" : ""}`}
                    title={cardRarityLabel(rarity, shiny, isEvolved)}
                  >
                    {evolved ? (
                      <svg
                        className="yk-evolved-symbol"
                        viewBox="0 4 24 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M6 16c5 0 7-8 12-8a4 4 0 0 1 0 8c-5 0-7-8-12-8a4 4 0 1 0 0 8Z" />
                      </svg>
                    ) : (
                      "✦"
                    )}
                  </span>
                )}
              </span>
            </div>
            {categoryAccessory && (
              <div className="yk-card-category-accessory">
                {categoryAccessory}
              </div>
            )}
            {rarityAccessory && (
              <div className="yk-card-rarity-accessory">{rarityAccessory}</div>
            )}
            {!image && (
              <span className="yk-card-missing">{t("artworkUnavailable")}</span>
            )}
            <div className="yk-card-bottom">
              <span className="yk-card-name" title={name}>
                {name}
              </span>
              {franchise && (
                <span className="yk-card-anime" title={franchise}>
                  {franchise}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CardBack({ className = "" }: { className?: string }) {
  const t = useTranslations("collectionShared");
  const style = useOwnProfileStyle();
  return (
    <div
      role="img"
      aria-label={t("cardBack")}
      className={`yk-card-back ${className}`}
      style={
        style?.cardBackUrl
          ? {
              backgroundImage: `url(${JSON.stringify(style.cardBackUrl)})`,
              backgroundSize: "cover",
              backgroundPosition: "center"
            }
          : undefined
      }
    />
  );
}
import { useOwnProfileStyle } from "@/components/pro-access";
