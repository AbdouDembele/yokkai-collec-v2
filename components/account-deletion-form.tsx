"use client";
import { gameErrorKey } from "@/i18n/game-messages";
import { useTranslations } from "next-intl";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import {
  deleteAccountAction,
  reconnectForDeletion
} from "@/app/settings/actions";

export function AccountDeletionForm({ pseudo }: { pseudo: string }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(deleteAccountAction, {});
  const [reconnectState, reconnectAction, reconnecting] = useActionState(
    reconnectForDeletion,
    {}
  );
  return (
    <section
      className="rounded-panel border border-danger bg-surface p-6"
      aria-labelledby="delete-account-title"
    >
      <h2 id="delete-account-title" className="font-display text-xl">
        {t("settingsUi.deleteMyAccount")}{" "}
      </h2>
      <p
        id="delete-account-consequences"
        className="mt-3 text-sm leading-6 text-ink-2"
      >
        {t("settingsUi.deletionPermanentNotice")}{" "}
      </p>
      <p className="mt-3 text-sm leading-6 text-ink-2">
        {t("settingsUi.deletionSubscriptionNotice")}{" "}
      </p>
      <p className="mt-3 text-sm leading-6 text-ink-2">
        <a href="#mes-donnees" className="underline underline-offset-4">
          {t("settingsUi.exportMyDataFirst")}{" "}
        </a>
      </p>
      <p className="mt-3 text-sm leading-6 text-ink-2">
        {t("settingsUi.deletionReauthNotice")}{" "}
      </p>
      <form action={action} className="mt-6 grid gap-4" aria-busy={pending}>
        <fieldset
          disabled={pending || Boolean(state.reconnect)}
          className="grid gap-4"
        >
          <label htmlFor="delete-account-pseudo" className="yk-field-label">
            {t("settingsUi.confirmUsername", { name: pseudo })}
          </label>
          <input
            id="delete-account-pseudo"
            name="pseudo"
            required
            maxLength={120}
            autoComplete="off"
            spellCheck={false}
            className="yk-field-control"
            aria-describedby="delete-account-consequences delete-account-error"
            aria-invalid={Boolean(state.error)}
          />
          <Button type="submit" disabled={pending}>
            {pending
              ? t("settingsUi.deletingAccount")
              : t("settingsUi.permanentlyDeleteMyAccount")}
          </Button>
        </fieldset>
        <p
          id="delete-account-error"
          role={state.error ? "alert" : undefined}
          className="text-sm text-danger"
        >
          {state.errorKey
            ? t(state.errorKey, state.errorValues)
            : state.error
              ? t(gameErrorKey(state.error, "settingsUi.couldntSaveSettings"))
              : ""}
        </p>
      </form>
      {state.reconnect && (
        <form action={reconnectAction} className="mt-4">
          <Button type="submit" disabled={reconnecting}>
            {reconnecting
              ? t("signOutButton.signingOut")
              : t("settingsUi.signInAgain")}
          </Button>
          {reconnectState.error && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {t(
                gameErrorKey(
                  reconnectState.error,
                  "settingsUi.couldntSaveSettings"
                )
              )}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
