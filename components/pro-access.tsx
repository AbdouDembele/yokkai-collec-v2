"use client";
import { useTranslations } from "next-intl";

import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import {
  DEFAULT_PROFILE_STYLE,
  normalizeProfileStyle,
  type ProfileStyle
} from "@/lib/ui/profile-style";

const ProAccess = createContext(false);
const OwnStyle = createContext<ProfileStyle | null>(null);
const ProMembership = createContext<boolean | null>(null);
// Cosmetic availability only; plan labels must use useProMembershipStatus.
export const useProAccess = () => useContext(ProAccess);
// Presentation-only status; null means unknown, unauthenticated, or unavailable.
export const useProMembershipStatus = () => useContext(ProMembership);
export const useOwnProfileStyle = () => useContext(OwnStyle);

// Presentation only. Every mutation independently checks paid membership on the server.
// No local storage, URL flags, or browser billing events can grant access.
export function ProAccessProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(false);
  const [style, setStyle] = useState<ProfileStyle | null>(null);
  const [membership, setMembership] = useState<boolean | null>(null);
  useEffect(() => {
    let stopped = false;
    let request: AbortController | null = null;
    async function sync() {
      if (request || stopped || document.visibilityState !== "visible") return;
      const controller = new AbortController();
      request = controller;
      const timeout = window.setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch("/api/pro/benefits", {
          cache: "no-store",
          signal: controller.signal
        });
        const result = response.ok ? await response.json() : null;
        if (
          stopped ||
          controller.signal.aborted ||
          document.visibilityState !== "visible"
        )
          return;
        // Membership comes only from benefits, never from cosmetic availability.
        // Publish it before the optional style request, which may fail or time out.
        setMembership(
          typeof result?.active === "boolean" ? result.active : null
        );
        let ownStyle: ProfileStyle | null = null;
        if (result?.active === true) {
          try {
            const styleResponse = await fetch("/api/pro/profile-style", {
              cache: "no-store",
              signal: controller.signal
            });
            const projection = styleResponse.ok
              ? await styleResponse.json()
              : null;
            if (projection?.active === true)
              ownStyle = normalizeProfileStyle({
                ...DEFAULT_PROFILE_STYLE,
                ...projection.style
              });
          } catch {
            // A cosmetic outage cannot change the confirmed membership status.
            ownStyle = null;
          }
        }
        if (controller.signal.aborted) ownStyle = null;
        if (!stopped && document.visibilityState === "visible") {
          setActive(result?.active === true && ownStyle !== null);
          setStyle(ownStyle);
        }
      } catch {
        if (!stopped) {
          setActive(false);
          setStyle(null);
          setMembership(null);
        }
      } finally {
        window.clearTimeout(timeout);
        request = null;
      }
    }
    const resume = () => {
      void sync();
    };
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);
    window.addEventListener("yokkai:profile-style-updated", resume);
    document.addEventListener("visibilitychange", resume);
    const timer = window.setInterval(resume, 30000);
    resume();
    return () => {
      stopped = true;
      request?.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("yokkai:profile-style-updated", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);
  return (
    <ProAccess.Provider value={active}>
      <ProMembership.Provider value={membership}>
        <OwnStyle.Provider value={active ? style : null}>
          {active && style?.backgroundUrl && (
            <div
              aria-hidden="true"
              className="yk-pro-site-background"
              style={{
                backgroundImage: `url(${JSON.stringify(style.backgroundUrl)})`
              }}
            />
          )}
          {children}
        </OwnStyle.Provider>
      </ProMembership.Provider>
    </ProAccess.Provider>
  );
}

export function ProFeatureNotice({ feature }: { feature: string }) {
  const tu = useTranslations("collectionShared");
  const membership = useProMembershipStatus();
  if (membership !== false) {
    return (
      <p className="mt-2 text-xs text-ink-2" role="status">
        {membership === true
          ? tu("proFeatureUnavailable", { feature })
          : tu("proMembershipUnavailable", { feature })}
      </p>
    );
  }
  return (
    <p className="mt-2 text-xs text-ink-2">
      {feature} {tu("availableToProMembersOnly")}{" "}
      <Link href="/premium" className="underline">
        {tu("discoverYokkaiPro")}
      </Link>
    </p>
  );
}
