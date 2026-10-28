"use client";

import { AuthForm } from "@/components/auth-form";

declare global {
  interface Window {
    __pseudoAvailabilityCalls?: string[];
  }
}

export function PseudoAvailabilityProof({
  disabled = false
}: {
  disabled?: boolean;
}) {
  return (
    <AuthForm
      mode="signup"
      checkPseudoAvailability={async pseudo => {
        (window.__pseudoAvailabilityCalls ??= []).push(pseudo);
        await new Promise(resolve =>
          window.setTimeout(resolve, pseudo === "Kitsune" ? 700 : 60)
        );
        if (disabled) return undefined;
        return pseudo !== "Kitsune";
      }}
    />
  );
}
