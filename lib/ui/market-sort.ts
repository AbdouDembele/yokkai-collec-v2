"use client";

import { useSyncExternalStore } from "react";

type MarketSort = "end" | "asc" | "desc" | "popular";
const STORAGE_KEY = "yokkai:market:sort:v1";
const listeners = new Set<() => void>();
let fallback: MarketSort = "end";
let memoryOnly = false;

function isMarketSort(value: unknown): value is MarketSort {
  return ["end", "asc", "desc", "popular"].includes(value as string);
}

function readSort(): MarketSort {
  if (typeof window === "undefined") return "end";
  if (memoryOnly) return fallback;
  try {
    const stored = window.sessionStorage.getItem(STORAGE_KEY);
    return isMarketSort(stored) ? stored : "end";
  } catch {
    return fallback;
  }
}

function saveSort(next: MarketSort) {
  if (typeof window === "undefined" || !isMarketSort(next)) return;
  fallback = next;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, next);
    memoryOnly = false;
  } catch {
    // Navigation within this tab still remembers the choice if storage is blocked.
    memoryOnly = true;
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const serverSort = (): MarketSort => "end";

export function useMarketSort() {
  // A fixed server snapshot prevents a hydration mismatch on a remembered sort.
  const sort = useSyncExternalStore(subscribe, readSort, serverSort);
  return [sort, saveSort] as const;
}
