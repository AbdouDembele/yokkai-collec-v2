"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_FILTER_SECTIONS_OPEN,
  FILTER_SECTIONS_OPEN_STORAGE_KEY,
  readFilterSectionsOpen,
  type FilterSectionsOpen
} from "@/lib/ui/filter-sections";

const listeners = new Set<() => void>();
let current: FilterSectionsOpen | undefined;

function read(): FilterSectionsOpen {
  current ??= readFilterSectionsOpen(() =>
    window.localStorage.getItem(FILTER_SECTIONS_OPEN_STORAGE_KEY)
  );
  return current;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Open/closed filter sections remembered per browser. The server render uses the default to avoid a hydration mismatch.
export function useFilterSectionsOpen() {
  const open = useSyncExternalStore(
    subscribe,
    read,
    () => DEFAULT_FILTER_SECTIONS_OPEN
  );
  const setSectionOpen = useCallback((id: string, value: boolean) => {
    const previous = read();
    if ((previous[id] ?? false) === value) return;
    current = { ...previous, [id]: value };
    try {
      window.localStorage.setItem(
        FILTER_SECTIONS_OPEN_STORAGE_KEY,
        JSON.stringify(current)
      );
    } catch {}
    listeners.forEach(listener => listener());
  }, []);
  return [open, setSectionOpen] as const;
}
