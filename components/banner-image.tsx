"use client";
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import { bannerGeometry, type BannerFrame } from "@/lib/ui/banner-frame";

export function BannerImage({
  src,
  frame,
  onReady,
  onError
}: {
  src: string;
  frame: BannerFrame;
  onReady?: (aspect: number) => void;
  onError?: () => void;
}) {
  const [loaded, setLoaded] = useState<{ src: string; aspect: number }>();
  const ready = loaded?.src === src;
  const geometry = bannerGeometry(ready ? loaded.aspect : 2.3, frame);
  return (
    <img
      className="yk-banner-framed-image"
      src={src}
      alt=""
      aria-hidden="true"
      decoding="async"
      draggable={false}
      style={{
        visibility: ready ? "visible" : "hidden",
        transform: `translate(${geometry.offsetX}%, ${geometry.offsetY}%) scale(${geometry.scale}) rotate(${geometry.rotation}deg)`
      }}
      onLoad={event => {
        const image = event.currentTarget;
        const aspect = image.naturalWidth / image.naturalHeight;
        setLoaded({ src, aspect });
        onReady?.(aspect);
      }}
      onError={onError}
    />
  );
}
