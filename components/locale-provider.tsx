"use client";

import type { ReactNode } from "react";
import { LocalePreferenceContext } from "./locale-controls";

export function LocalePreferenceProvider({
  children,
  value
}: {
  children: ReactNode;
  value: { enabled: boolean; mode: "auto" | "manual"; dismissed: boolean };
}) {
  return (
    <LocalePreferenceContext.Provider value={value}>
      {children}
    </LocalePreferenceContext.Provider>
  );
}
