"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Re-renders the server page every minute while the tab is visible. The host
// monitor writes a snapshot every 5 minutes, so polling faster adds nothing.
export function MonitoringAutoRefresh({ intervalMs = 60_000 }) {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer || document.visibilityState !== "visible") return;
      timer = setInterval(() => router.refresh(), intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
        start();
      } else stop();
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router, intervalMs]);
  return null;
}
