"use client";

import { useEffect } from "react";

export function NetworkSecurityObserver() {
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/security/network-observation", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal
    }).catch(() => undefined);
    return () => controller.abort();
  }, []);
  return null;
}
