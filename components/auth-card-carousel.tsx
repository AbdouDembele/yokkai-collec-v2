"use client";

import { useTranslations } from "next-intl";

import { useEffect, useRef, type ReactNode } from "react";
import {
  enableAutomaticScroll,
  enableHorizontalWheel,
  scrollStripBy
} from "@/lib/ui/horizontal-wheel";

export function AuthCardCarousel({ children }: { children: ReactNode }) {
  const t = useTranslations("authCardCarousel");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const stopWheel = enableHorizontalWheel(element);
    const stopAutomatic = enableAutomaticScroll(element);
    return () => {
      stopAutomatic();
      stopWheel();
    };
  }, []);

  return (
    <div className="yk-auth-card-window">
      <div
        className="yk-auth-card-scroll"
        ref={scrollRef}
        role="region"
        aria-label={t("discoverCards", { rarity: "LR" })}
        aria-describedby="auth-carousel-help"
        tabIndex={0}
        onKeyDown={event => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          scrollStripBy(
            event.currentTarget,
            event.key === "ArrowLeft" ? -180 : 180
          );
        }}
      >
        {children}
      </div>
      <p id="auth-carousel-help" className="sr-only">
        {t("scrollHelp")}
      </p>
    </div>
  );
}
