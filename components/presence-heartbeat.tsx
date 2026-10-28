"use client";

import { useBoostersLoadPriority } from "@/components/boosters-load-priority";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { touchPresence } from "@/lib/data/friends";

const PRESENCE_THROTTLE_MS = 30_000;
const ACTIVITY_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "scroll",
  "touchstart"
] as const;

export function PresenceHeartbeat() {
  const ready = useBoostersLoadPriority() >= 2;
  const pathname = usePathname();
  useEffect(() => {
    if (!ready || pathname.startsWith("/design-system/")) return;
    let active = true;
    let lastPulseAt = 0;
    const pulse = (force = false) => {
      if (!active || document.visibilityState === "hidden") return;
      const now = Date.now();
      if (!force && now - lastPulseAt < PRESENCE_THROTTLE_MS) return;
      lastPulseAt = now;
      void touchPresence().catch(() => undefined);
    };
    const onActivity = () => pulse();
    const onVisible = () => {
      if (document.visibilityState === "visible") pulse();
    };
    pulse(true);
    for (const event of ACTIVITY_EVENTS)
      window.addEventListener(event, onActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      for (const event of ACTIVITY_EVENTS)
        window.removeEventListener(event, onActivity);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ready, pathname]);
  return null;
}
