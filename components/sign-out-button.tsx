"use client";
import { authMessageKey } from "@/i18n/auth-messages";
import { useTranslations } from "next-intl";

import { useActionState } from "react";
import { signOut } from "@/app/auth/actions";
import type { AuthState } from "@/lib/auth/forms";

export function SignOutButton() {
  const authT = useTranslations("authErrors");

  const t = useTranslations("signOutButton");
  const [state, action, pending] = useActionState<AuthState, FormData>(
    signOut,
    {}
  );
  return (
    <form action={action}>
      <button
        type="submit"
        disabled={pending}
        className="yk-account-action yk-account-logout"
      >
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10 17l5-5-5-5M15 12H3M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5" />
        </svg>
        {pending ? t("signingOut") : t("signOut")}
      </button>
      {state.error && (
        <p role="alert" className="mt-2 max-w-56 text-xs text-red-200">
          {authT(
            state.errorKey ?? authMessageKey(state.error),
            state.errorValues
          )}
        </p>
      )}
    </form>
  );
}
