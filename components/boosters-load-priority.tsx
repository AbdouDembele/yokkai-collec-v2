"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode
} from "react";
import { usePathname } from "next/navigation";
const Priority = createContext(2);
const backgroundEvent = "yokkai:boosters-background";
export function releaseBoostersBackground() {
  window.dispatchEvent(new Event(backgroundEvent));
}
export function useBoostersLoadPriority() {
  return useContext(Priority);
}
export function BoostersLoadPriority({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Social tabs share their layout and feed stores. Re-keying the entire tree
  // for every tab discards that state; other routes retain their reset fence.
  const sessionKey =
    pathname === "/social" || pathname.startsWith("/social/")
      ? "/social"
      : pathname;
  return (
    <PrioritySession key={sessionKey} pathname={pathname}>
      {children}
    </PrioritySession>
  );
}
export function PrioritySession({
  children,
  pathname
}: {
  children: ReactNode;
  pathname: string;
}) {
  const [secondaryFor, setSecondaryFor] = useState<string | null>(null);
  const boosters = pathname === "/boosters";
  const stage = !boosters || secondaryFor === pathname ? 2 : 0;
  useEffect(() => {
    if (!boosters) return;
    const release = () => setSecondaryFor(pathname);
    const secondary = window.setTimeout(() => setSecondaryFor(pathname), 2000);
    window.addEventListener(backgroundEvent, release);
    return () => {
      clearTimeout(secondary);
      window.removeEventListener(backgroundEvent, release);
    };
  }, [boosters, pathname]);
  return <Priority value={stage}>{children}</Priority>;
}
