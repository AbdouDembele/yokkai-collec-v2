"use client";
import { authMessageKey } from "@/i18n/auth-messages";
import { useTranslations } from "next-intl";

import { AuthTurnstile } from "@/components/auth-turnstile";

import Link from "next/link";
import { useActionState } from "react";
import {
  requestPasswordReset,
  updateRecoveredPassword
} from "@/app/auth/actions";
import type { AuthState } from "@/lib/auth/forms";

export function PasswordResetRequestForm({
  invalidLink = false,
  confirmationUnavailable = false
}: {
  invalidLink?: boolean;
  confirmationUnavailable?: boolean;
}) {
  const authT = useTranslations("authErrors");

  const t = useTranslations("passwordResetForms");
  const [state, action, pending] = useActionState<AuthState, FormData>(
    requestPasswordReset,
    {}
  );
  if (state.success)
    return (
      <div role="status" className="yk-auth-success">
        <div className="yk-auth-success-panel">
          <span className="yk-auth-success-icon" aria-hidden="true">
            ✓
          </span>
          <div>
            <h2>{t("checkYourInbox")}</h2>
            <p>{t("ifAnAccountMatchesThisEmailAddressYouLlReceive")}</p>
          </div>
        </div>
        <Link href="/login" className="yk-auth-link">
          {t("backToSignIn")}
        </Link>
      </div>
    );

  return (
    <form action={action} className="yk-auth-form" aria-busy={pending}>
      {invalidLink && (
        <p role="alert" className="auth-error">
          {t("thisPasswordResetLinkIsInvalidExpiredOrAlreadyUsed")}
        </p>
      )}
      {confirmationUnavailable && (
        <p role="alert" className="auth-error">
          {t("linkVerificationIsTemporarilyUnavailableTryYourLinkAgainIn")}
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
        <legend className="sr-only">{t("requestAPasswordResetLink")}</legend>
        <div>
          <label htmlFor="email" className="auth-label">
            {t("email")}
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            defaultValue={state.values?.email}
            className="auth-input"
            placeholder="you@example.com"
            aria-invalid={Boolean(state.fields?.email)}
            aria-describedby={state.fields?.email ? "email-error" : undefined}
          />
          {state.fields?.email && (
            <p id="email-error" role="alert">
              {authT(authMessageKey(state.fields.email))}
            </p>
          )}
        </div>
        <AuthTurnstile />
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="primary yk-auth-submit"
        >
          {pending ? t("sendingLink") : t("sendLink")}
        </button>
      </fieldset>
      <p className="yk-auth-switch">
        <Link href="/login" className="yk-auth-link">
          {t("backToSignInLabel")}
        </Link>
      </p>
    </form>
  );
}

export function PasswordUpdateForm() {
  const authT = useTranslations("authErrors");

  const t = useTranslations("passwordResetForms");
  const [state, action, pending] = useActionState<AuthState, FormData>(
    updateRecoveredPassword,
    {}
  );
  return (
    <form action={action} className="yk-auth-form" aria-busy={pending}>
      {state.error && (
        <p role="alert" className="auth-error">
          {authT(
            state.errorKey ?? authMessageKey(state.error),
            state.errorValues
          )}
        </p>
      )}
      <fieldset disabled={pending}>
        <legend className="sr-only">{t("chooseANewPassword")}</legend>
        <div>
          <label htmlFor="password" className="auth-label">
            {t("newPassword")}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            className="auth-input"
            aria-invalid={Boolean(state.fields?.password)}
            aria-describedby={
              state.fields?.password
                ? "password-help password-error"
                : "password-help"
            }
          />
          <p id="password-help" className="mt-2 text-xs text-white/50">
            {t("atLeast8Characters")}
          </p>
          {state.fields?.password && (
            <p id="password-error" role="alert">
              {authT(authMessageKey(state.fields.password))}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="confirmPassword" className="auth-label">
            {t("confirmPassword")}
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            className="auth-input"
            aria-invalid={Boolean(state.fields?.confirmPassword)}
            aria-describedby={
              state.fields?.confirmPassword
                ? "confirm-password-error"
                : undefined
            }
          />
          {state.fields?.confirmPassword && (
            <p id="confirm-password-error" role="alert">
              {authT(authMessageKey(state.fields.confirmPassword))}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="primary yk-auth-submit"
        >
          {pending ? t("updating") : t("saveNewPassword")}
        </button>
      </fieldset>
    </form>
  );
}
