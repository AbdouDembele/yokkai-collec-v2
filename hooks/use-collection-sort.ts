"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_COLLECTION_SORT,
  isCollectionSort,
  type CollectionSort
} from "@/lib/ui/collection-sort";

export const COLLECTION_SORT_STORAGE_KEY = "yokkai:collection-sort";
const listeners = new Set<() => void>();
let current: CollectionSort | undefined;

// Read once per page load; storage can be missing or throw (private mode, blocked site data).
function read(): CollectionSort {
  if (current === undefined) {
    try {
      const stored = window.localStorage.getItem(COLLECTION_SORT_STORAGE_KEY);
      current = isCollectionSort(stored) ? stored : DEFAULT_COLLECTION_SORT;
    } catch {
      current = DEFAULT_COLLECTION_SORT;
    }
  }
  return current;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Collection sort remembered per browser. The server render uses the default to avoid a hydration mismatch.
export function useCollectionSort() {
  const sort = useSyncExternalStore(
    subscribe,
    read,
    () => DEFAULT_COLLECTION_SORT
  );
  const setSort = useCallback((next: CollectionSort) => {
    current = next;
    try {
      window.localStorage.setItem(COLLECTION_SORT_STORAGE_KEY, next);
    } catch {}
    listeners.forEach(listener => listener());
  }, []);
  return [sort, setSort] as const;
}
