"use client";
import { authMessageKey } from "@/i18n/auth-messages";
import { useTranslations } from "next-intl";

import { AuthTurnstile } from "@/components/auth-turnstile";

import Link from "next/link";
import { ConfirmationResendForm } from "@/components/confirmation-resend-form";
import { useActionState, useEffect, useRef, useState } from "react";
import {
  checkPseudoAvailabilityWhileTyping,
  signIn,
  signUp
} from "@/app/auth/actions";
import {
  PSEUDO_NO_EMOJI_PATTERN,
  pseudoValidationError,
  SIGNUP_POLICY_VERSION,
  type AuthState
} from "@/lib/auth/forms";

type PseudoAvailability = "idle" | "checking" | "available" | "taken";

export function AuthForm({
  mode,
  referralCode,
  confirmationError = false,
  confirmationUnavailable = false,
  checkPseudoAvailability = checkPseudoAvailabilityWhileTyping
}: {
  mode: "signin" | "signup";
  referralCode?: string;
  confirmationError?: boolean;
  confirmationUnavailable?: boolean;
  checkPseudoAvailability?: (pseudo: string) => Promise<boolean | undefined>;
}) {
  const authT = useTranslations("authErrors");

  const t = useTranslations("authForm");
  const signup = mode === "signup";
  const [state, action, pending] = useActionState<AuthState, FormData>(
    signup ? signUp : signIn,
    {}
  );
  const [pseudo, setPseudo] = useState(state.values?.pseudo ?? "");
  const [policiesAccepted, setPoliciesAccepted] = useState(false);
  const pseudoError =
    (signup && pseudo ? pseudoValidationError(pseudo.trim()) : undefined) ||
    (pseudo.trim() === state.values?.pseudo ? state.fields?.pseudo : undefined);
  const [pseudoAvailability, setPseudoAvailability] =
    useState<PseudoAvailability>("idle");
  const pseudoRequest = useRef(0);
  useEffect(() => {
    if (!signup || pseudoValidationError(pseudo.trim())) return;
    const request = pseudoRequest.current;
    const timeout = window.setTimeout(async () => {
      setPseudoAvailability("checking");
      const available = await checkPseudoAvailability(pseudo.trim());
      if (pseudoRequest.current !== request) return;
      setPseudoAvailability(
        available === true
          ? "available"
          : available === false
            ? "taken"
            : "idle"
      );
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [checkPseudoAvailability, pseudo, signup]);
  if (state.success)
    return (
      <div className="yk-auth-success">
        <div role="status" className="yk-auth-success-panel">
          <span className="yk-auth-success-icon" aria-hidden="true">
            ✓
          </span>
          <div>
            <h2>{t("checkYourInbox")}</h2>
            <p>{t("ifThisEmailAddressCanBeUsedToCreateAn")}</p>
          </div>
        </div>
        <ConfirmationResendForm
          email={state.values?.email}
          initialDelay={state.retryAfter}
        />
        <Link href="/login" className="yk-auth-link">
          {t("signIn")}
        </Link>
      </div>
    );

  return (
    <>
      <form action={action} className="yk-auth-form" aria-busy={pending}>
        {signup && referralCode && (
          <>
            <input type="hidden" name="referralCode" value={referralCode} />
            <p role="status" className="yk-auth-success-panel text-sm">
              {t("referralInvitationAppliedYouAndYourFriendWillEachReceive")}
            </p>
          </>
        )}
        {confirmationError && (
          <p role="alert" className="auth-error">
            {t("thisConfirmationLinkIsInvalidExpiredOrAlreadyUsedIf")}
          </p>
        )}
        {confirmationUnavailable && (
          <p role="alert" className="auth-error">
            {t("emailConfirmationIsTemporarilyUnavailableTryYourLinkAgainIn")}
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
          <legend className="sr-only">
            {signup ? t("createAnAccount") : t("signInLabel")}
          </legend>
          {signup && (
            <div>
              <label htmlFor="pseudo" className="auth-label">
                {t("username")}
              </label>
              <input
                id="pseudo"
                name="pseudo"
                autoComplete="nickname"
                required
                pattern={PSEUDO_NO_EMOJI_PATTERN}
                title={t("chooseAUsernameWithoutEmoji")}
                value={pseudo}
                onChange={event => {
                  pseudoRequest.current += 1;
                  setPseudo(event.target.value);
                  setPseudoAvailability("idle");
                  event.currentTarget.setCustomValidity(
                    pseudoValidationError(event.currentTarget.value.trim()) ??
                      ""
                  );
                }}
                className="auth-input"
                placeholder={t("yourCollectorName")}
                aria-invalid={Boolean(pseudoError)}
                aria-describedby={
                  pseudoError
                    ? "pseudo-error"
                    : pseudoAvailability !== "idle"
                      ? "pseudo-availability"
                      : "pseudo-help"
                }
              />
              {!pseudoError && pseudoAvailability === "idle" && (
                <p id="pseudo-help" className="mt-2 text-xs text-white/50">
                  {t("text330Characters")}
                </p>
              )}
              {!pseudoError && pseudoAvailability !== "idle" && (
                <p
                  id="pseudo-availability"
                  className={`mt-2 text-xs ${pseudoAvailability === "available" ? "text-lime-300" : pseudoAvailability === "taken" ? "text-red-200" : "text-white/50"}`}
                  role="status"
                >
                  {pseudoAvailability === "checking"
                    ? t("checking")
                    : pseudoAvailability === "available"
                      ? t("available")
                      : t("alreadyTaken")}
                </p>
              )}
              {pseudoError && (
                <p
                  id="pseudo-error"
                  className="mt-2 text-sm text-red-200"
                  role="alert"
                >
                  {authT(authMessageKey(pseudoError))}
                </p>
              )}
            </div>
          )}
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
              <p
                id="email-error"
                className="mt-2 text-sm text-red-200"
                role="alert"
              >
                {authT(authMessageKey(state.fields.email))}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="password" className="auth-label">
              {t("password")}
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete={signup ? "new-password" : "current-password"}
              required
              minLength={signup ? 8 : undefined}
              maxLength={signup ? 128 : undefined}
              className="auth-input"
              aria-invalid={Boolean(state.fields?.password)}
              aria-describedby={
                state.fields?.password
                  ? "password-error"
                  : signup
                    ? "password-help"
                    : undefined
              }
            />
            {signup && (
              <p id="password-help" className="mt-2 text-xs text-white/50">
                {t("atLeast8Characters")}
              </p>
            )}
            {state.fields?.password && (
              <p
                id="password-error"
                className="mt-2 text-sm text-red-200"
                role="alert"
              >
                {authT(authMessageKey(state.fields.password))}
              </p>
            )}
          </div>
          {signup && (
            <div className="yk-auth-policy">
              <div className="yk-auth-policy-row">
                <input
                  id="accepted-policies"
                  name="acceptedPolicies"
                  type="checkbox"
                  value={SIGNUP_POLICY_VERSION}
                  required
                  checked={policiesAccepted}
                  onChange={event => setPoliciesAccepted(event.target.checked)}
                  aria-invalid={Boolean(state.fields?.acceptedPolicies)}
                  aria-describedby={
                    state.fields?.acceptedPolicies ? "policy-error" : undefined
                  }
                />
                <label htmlFor="accepted-policies">
                  {t("iAgreeToThe")}{" "}
                  <Link
                    href="/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="yk-auth-link"
                    aria-label={t("termsOfUseOpensInANewTab")}
                  >
                    {t("termsOfUse")}
                  </Link>{" "}
                  {t("and")}{" "}
                  <Link
                    href="/rules"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="yk-auth-link"
                    aria-label={t("communityRulesOpensInANewTab")}
                  >
                    {t("communityRules")}
                  </Link>
                  .
                </label>
              </div>
              <p className="yk-auth-policy-note">
                {t("privacyAgreement")}{" "}
                <Link
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="yk-auth-link"
                  aria-label={t("privacyPolicyOpensInANewTab")}
                >
                  {t("privacyPolicy")}
                </Link>
                .
              </p>
              {state.fields?.acceptedPolicies && (
                <p id="policy-error" className="auth-error" role="alert">
                  {authT(authMessageKey(state.fields.acceptedPolicies))}
                </p>
              )}
            </div>
          )}
          <AuthTurnstile />
          <button
            type="submit"
            disabled={pending}
            aria-busy={pending}
            className="primary yk-auth-submit"
          >
            {pending
              ? signup
                ? t("creatingAccount")
                : t("signingIn")
              : signup
                ? t("createMyAccount")
                : t("signInLabel")}
          </button>
        </fieldset>
        <p className="yk-auth-switch">
          {signup ? t("alreadyHaveAnAccount") : t("newHere")}
          <Link href={signup ? "/login" : "/signup"} className="yk-auth-link">
            {signup ? t("signInLabel") : t("joinTheHunt")}
          </Link>
        </p>
        {!signup && (
          <p className="yk-auth-switch">
            <Link href="/forgot-password" className="yk-auth-link">
              {t("forgotPassword")}
            </Link>
          </p>
        )}
      </form>
      {!signup && (
        <details
          className="yk-auth-switch"
          open={confirmationError || state.needsConfirmation || undefined}
        >
          <summary className="yk-auth-link">
            {t("resendConfirmationLink")}
          </summary>
          <ConfirmationResendForm
            key={state.values?.email}
            email={state.values?.email}
          />
        </details>
      )}
    </>
  );
}
