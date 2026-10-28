"use client";

import { useEffect, useRef } from "react";
import "@/styles/ambient-glow.css";

export function AmbientGlow({
  variant = "packs"
}: {
  variant?: "packs" | "home";
}) {
  const layer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = layer.current;
    if (!node) return;
    const sync = () => {
      node.dataset.paused = String(document.visibilityState !== "visible");
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [variant]);

  if (variant === "packs")
    return <span className="yk-pack-ambient" aria-hidden="true" />;
  return (
    <div
      ref={layer}
      className="yk-home-ambient"
      aria-hidden="true"
      data-paused="true"
    >
      <span />
      <span />
      <span />
    </div>
  );
}
