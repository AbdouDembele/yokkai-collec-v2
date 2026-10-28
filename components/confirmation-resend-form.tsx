"use client";
import { authMessageKey } from "@/i18n/auth-messages";
import { useTranslations } from "next-intl";

import { AuthTurnstile } from "@/components/auth-turnstile";

import { useActionState, useEffect, useState } from "react";
import { resendConfirmation } from "@/app/auth/actions";
import { authError, type AuthState } from "@/lib/auth/forms";

export function ConfirmationResendForm({
  email = "",
  initialDelay = 0
}: {
  email?: string;
  initialDelay?: number;
}) {
  const authT = useTranslations("authErrors");

  const t = useTranslations("confirmationResendForm");
  const [remaining, setRemaining] = useState(initialDelay);
  const waiting = remaining > 0;
  const [state, action, pending] = useActionState<AuthState, FormData>(
    async (previous, form) => {
      try {
        const result = await resendConfirmation(previous, form);
        setRemaining(result.retryAfter ?? 0);
        return result;
      } catch {
        setRemaining(60);
        return { error: authError(), errorKey: "unavailable" };
      }
    },
    {}
  );
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(
      () => setRemaining(value => Math.max(0, value - 1)),
      1000
    );
    return () => window.clearInterval(timer);
  }, [waiting]);

  return (
    <form action={action} className="yk-auth-form" aria-busy={pending}>
      <p>{t("ifThisEmailAddressBelongsToAnAccountAwaitingConfirmation")}</p>
      {state.success && (
        <p role="status" className="yk-auth-notice">
          {t("ifConfirmationIsNeededWeLlSendYouAnEmail")}
        </p>
      )}
      {state.error && (
        <p role="alert" className="auth-error">
          {authT(
            state.errorKey ?? authMessageKey(state.error),
            state.errorValues
          )}
        </p>
      )}
      <fieldset disabled={pending}>
        <legend className="sr-only">{t("resendEmailConfirmation")}</legend>
        <label htmlFor="confirmation-email" className="auth-label">
          {t("emailAddressToConfirm")}
        </label>
        <input
          id="confirmation-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          defaultValue={state.values?.email ?? email}
          className="auth-input"
          aria-invalid={Boolean(state.fields?.email)}
          aria-describedby={
            state.fields?.email ? "confirmation-email-error" : undefined
          }
        />
        {state.fields?.email && (
          <p id="confirmation-email-error" role="alert" className="auth-error">
            {authT(authMessageKey(state.fields.email))}
          </p>
        )}
        <AuthTurnstile />
        <button
          type="submit"
          className="primary yk-auth-submit"
          disabled={pending || waiting}
          aria-busy={pending}
        >
          {pending
            ? t("sendingRequest")
            : waiting
              ? t("resendIn", { count: remaining })
              : t("resendConfirmation")}
        </button>
      </fieldset>
    </form>
  );
}
