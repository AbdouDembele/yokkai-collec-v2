"use client";

import { useTranslations } from "next-intl";
import { authMessageKey } from "@/i18n/auth-messages";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { checkPseudoAvailabilityWhileTyping } from "@/app/auth/actions";
import { chooseUsername } from "@/app/auth/oauth-actions";
import {
  PSEUDO_NO_EMOJI_PATTERN,
  pseudoValidationError,
  SIGNUP_POLICY_VERSION,
  type AuthState
} from "@/lib/auth/forms";

// Username step of new Google/Discord accounts: same rules as the signup form.
export function ChooseUsernameForm({
  checkPseudoAvailability = checkPseudoAvailabilityWhileTyping
}: {
  checkPseudoAvailability?: (pseudo: string) => Promise<boolean | undefined>;
}) {
  const t = useTranslations("authForm");
  const authT = useTranslations("authErrors");
  const [state, action, pending] = useActionState<AuthState, FormData>(
    chooseUsername,
    {}
  );
  const [pseudo, setPseudo] = useState(state.values?.pseudo ?? "");
  const [availability, setAvailability] = useState<
    "idle" | "checking" | "available" | "taken"
  >("idle");
  const request = useRef(0);
  const pseudoError =
    (pseudo ? pseudoValidationError(pseudo.trim()) : undefined) ||
    (pseudo.trim() === state.values?.pseudo ? state.fields?.pseudo : undefined);
  useEffect(() => {
    if (pseudoValidationError(pseudo.trim())) return;
    const current = request.current;
    const timeout = window.setTimeout(async () => {
      setAvailability("checking");
      const available = await checkPseudoAvailability(pseudo.trim());
      if (request.current !== current) return;
      setAvailability(
        available === true
          ? "available"
          : available === false
            ? "taken"
            : "idle"
      );
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [checkPseudoAvailability, pseudo]);

  return (
    <form action={action} className="yk-auth-form" aria-busy={pending}>
      {state.error && (
        <p role="alert" className="auth-error">
          {authT(authMessageKey(state.error))}
        </p>
      )}
      <fieldset disabled={pending}>
        <legend className="sr-only">{t("chooseYourUsername")}</legend>
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
              request.current += 1;
              setPseudo(event.target.value);
              setAvailability("idle");
              event.currentTarget.setCustomValidity(
                pseudoValidationError(event.currentTarget.value.trim())
                  ? authT(
                      authMessageKey(
                        pseudoValidationError(event.currentTarget.value.trim())!
                      )
                    )
                  : ""
              );
            }}
            className="auth-input"
            placeholder={t("yourCollectorName")}
            aria-invalid={Boolean(pseudoError)}
            aria-describedby={pseudoError ? "pseudo-error" : "pseudo-help"}
          />
          {pseudoError ? (
            <p id="pseudo-error" className="mt-2 text-sm" role="alert">
              {authT(authMessageKey(pseudoError))}
            </p>
          ) : (
            <p
              id="pseudo-help"
              className={`mt-2 text-xs ${availability === "available" ? "text-lime-300" : availability === "taken" ? "text-red-200" : "text-white/50"}`}
              role="status"
            >
              {availability === "checking"
                ? t("checking")
                : availability === "available"
                  ? t("available")
                  : availability === "taken"
                    ? t("alreadyTaken")
                    : t("text330Characters")}
            </p>
          )}
        </div>
        <div className="yk-auth-policy">
          <div className="yk-auth-policy-row">
            <input
              id="accepted-policies"
              name="acceptedPolicies"
              type="checkbox"
              value={SIGNUP_POLICY_VERSION}
              required
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
          {state.fields?.acceptedPolicies && (
            <p id="policy-error" className="auth-error" role="alert">
              {authT(authMessageKey(state.fields.acceptedPolicies))}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="primary yk-auth-submit"
        >
          {pending ? t("savingUsername") : t("startCollecting")}
        </button>
      </fieldset>
    </form>
  );
}
