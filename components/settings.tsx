"use client";
import { gameErrorKey } from "@/i18n/game-messages";
import { useTranslations } from "next-intl";

import { AuthTurnstile } from "@/components/auth-turnstile";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button, Toast } from "@/components/ui";
import { getProfilePrivacy, setProfilePrivacy } from "@/lib/data/settings";
import { authMessageKey } from "@/i18n/auth-messages";
import { changePassword } from "@/app/auth/actions";

function PasswordChangeForm() {
  const t = useTranslations();
  const [state, action, pending] = useActionState(changePassword, {});
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state.success]);
  return (
    <form
      ref={formRef}
      action={action}
      className="mt-6 grid gap-4"
      aria-busy={pending}
    >
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {t(
            `authErrors.${state.errorKey ?? authMessageKey(state.error)}`,
            state.errorValues
          )}
        </p>
      )}
      {state.success && (
        <p role="status" className="text-sm text-success">
          {t("settingsUi.passwordUpdated")}{" "}
        </p>
      )}
      <fieldset disabled={pending} className="grid gap-4">
        <label className="block" htmlFor="currentPassword">
          <span className="yk-field-label">
            {t("settingsUi.currentPassword")}
          </span>
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
            className="yk-field-control"
            aria-invalid={Boolean(state.fields?.currentPassword)}
            aria-describedby={
              state.fields?.currentPassword
                ? "current-password-error"
                : undefined
            }
          />
          {state.fields?.currentPassword && (
            <span
              id="current-password-error"
              role="alert"
              className="yk-field-help yk-field-error"
            >
              {t(`authErrors.${authMessageKey(state.fields.currentPassword)}`)}
            </span>
          )}
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block" htmlFor="newPassword">
            <span className="yk-field-label">
              {t("passwordResetForms.newPassword")}
            </span>
            <input
              id="newPassword"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              className="yk-field-control"
              aria-invalid={Boolean(state.fields?.password)}
              aria-describedby={
                state.fields?.password ? "new-password-error" : undefined
              }
            />
            {state.fields?.password && (
              <span
                id="new-password-error"
                role="alert"
                className="yk-field-help yk-field-error"
              >
                {t(`authErrors.${authMessageKey(state.fields.password)}`)}
              </span>
            )}
          </label>
          <label className="block" htmlFor="confirmPassword">
            <span className="yk-field-label">
              {t("settingsUi.confirmNewPassword")}
            </span>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              className="yk-field-control"
              aria-invalid={Boolean(state.fields?.confirmPassword)}
              aria-describedby={
                state.fields?.confirmPassword
                  ? "confirm-password-settings-error"
                  : undefined
              }
            />
            {state.fields?.confirmPassword && (
              <span
                id="confirm-password-settings-error"
                role="alert"
                className="yk-field-help yk-field-error"
              >
                {t(
                  `authErrors.${authMessageKey(state.fields.confirmPassword)}`
                )}
              </span>
            )}
          </label>
        </div>
        <AuthTurnstile />
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending
              ? t("passwordResetForms.updating")
              : t("settingsUi.changePassword")}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

export function SettingsPanel() {
  const t = useTranslations();
  const [isPublic, setIsPublic] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  useEffect(() => {
    void getProfilePrivacy().then(setIsPublic, reason =>
      setError(
        reason instanceof Error ? reason.message : "Couldn't load settings."
      )
    );
  }, []);
  async function save() {
    if (isPublic === undefined) return;
    setBusy(true);
    setError("");
    try {
      setIsPublic(await setProfilePrivacy(isPublic));
      setToast("Privacy settings updated");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Couldn't save settings."
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-6">
      <section className="rounded-panel border border-veil bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-2xl">
            <h2 className="font-display text-xl">
              {t("settingsUi.profilePrivacy")}
            </h2>
            <p className="mt-3 text-sm leading-6 text-ink-2">
              {t("settingsUi.privacyDescription")}{" "}
            </p>
            <p className="mt-3 text-xs leading-5 text-ink-3">
              {t("settingsUi.privateProfileNotice")}{" "}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-label={
              isPublic === false
                ? t("settingsUi.makeProfilePublic")
                : t("settingsUi.makeProfilePrivate")
            }
            aria-checked={isPublic === undefined ? false : !isPublic}
            disabled={isPublic === undefined || busy}
            className="yk-shiny-toggle"
            onClick={() => setIsPublic(value => !value)}
          >
            <span>
              {isPublic === undefined
                ? t("packs.loading")
                : isPublic
                  ? t("settingsUi.publicProfile")
                  : t("settingsUi.privateProfile")}
            </span>
            <i aria-hidden="true" />
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-5 text-sm text-danger">
            {t(gameErrorKey(error, "settingsUi.couldntSaveSettings"))}
          </p>
        )}
        <div className="mt-6 flex justify-end">
          <Button
            disabled={isPublic === undefined || busy}
            onClick={() => void save()}
          >
            {busy ? t("collectionUi.saving") : t("profileUi.save")}
          </Button>
        </div>
        <Toast
          message={
            toast ? t(gameErrorKey(toast, "profileUi.profileUnavailable")) : ""
          }
          onDismiss={() => setToast("")}
        />
      </section>
      <section className="rounded-panel border border-veil bg-surface p-6">
        <div className="max-w-2xl">
          <h2 className="font-display text-xl">{t("authForm.password")}</h2>
          <p className="mt-3 text-sm leading-6 text-ink-2">
            {t("settingsUi.passwordChangeHint")}{" "}
          </p>
        </div>
        <PasswordChangeForm />
      </section>
    </div>
  );
}
