"use client";
import { useSyncExternalStore } from "react";
import { i18nEnabled } from "@/i18n/locale";
const subscribeToHydration = () => () => {};
import { useTranslations, useFormatter } from "next-intl";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar, Button } from "@/components/ui";
import { getMyReferrals } from "@/lib/referrals/client";
import type { ReferralPage } from "@/lib/referrals/shared";

function ReferralDate({ value }: { value: string | null }) {
  const fmt = useFormatter();
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false
  );
  const t = useTranslations();
  if (!value || Number.isNaN(Date.parse(value)))
    return <span>{t("packs.unavailable")}</span>;
  return (
    <time
      dateTime={value}
      title={
        i18nEnabled() && !hydrated
          ? "…"
          : i18nEnabled()
            ? fmt.dateTime(new Date(value), {
                ...{},
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
              })
            : new Date(value).toLocaleString("en-US")
      }
    >
      {i18nEnabled() && !hydrated
        ? "…"
        : i18nEnabled()
          ? fmt.dateTime(new Date(value), {
              ...{
                month: "short",
                day: "numeric",
                year: "numeric"
              },
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
            })
          : new Date(value).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric"
            })}
      <span className="mt-1 block text-xs font-normal text-ink-3">
        {i18nEnabled() && !hydrated
          ? "…"
          : i18nEnabled()
            ? fmt.dateTime(new Date(value), {
                ...{
                  hour: "numeric",
                  minute: "2-digit"
                },
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
              })
            : new Date(value).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit"
              })}
      </span>
    </time>
  );
}

export function ReferralDetails() {
  const fmt = useFormatter();
  const t = useTranslations();
  const [page, setPage] = useState<ReferralPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    getMyReferrals(offset)
      .then(data => {
        if (active) {
          setPage(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setError(true);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [offset, retry]);

  function changePage(next: number) {
    setLoading(true);
    setError(false);
    setOffset(next);
  }

  return (
    <div className="yk-referral-details" aria-busy={loading}>
      <p className="text-sm leading-6 text-ink-2">
        {t("settingsUi.referralsDescription")}{" "}
      </p>
      {loading ? (
        <div role="status" className="yk-referral-loading">
          <span className="yk-referral-spinner" aria-hidden="true" />
          {t("settingsUi.loadingYourReferrals")}{" "}
        </div>
      ) : error ? (
        <div role="alert" className="yk-referral-empty">
          <p>{t("settingsUi.referralsLoadFailed")}</p>
          <Button
            type="button"
            onClick={() => {
              setError(false);
              setLoading(true);
              setRetry(value => value + 1);
            }}
          >
            {t("packs.tryAgain")}{" "}
          </Button>
        </div>
      ) : page && page.total === 0 ? (
        <div className="yk-referral-empty">
          <p className="font-semibold">{t("settingsUi.referralsEmptyTitle")}</p>
          <p className="text-sm text-ink-2">
            {t("settingsUi.referralsEmptyHint")}{" "}
          </p>
        </div>
      ) : page ? (
        <>
          <p className="my-4 text-xs text-ink-3" role="status">
            {t("settingsUi.referralTotal", { count: page.total })}
          </p>
          <ul className="yk-referral-list">
            {page.referrals.map(person => (
              <li key={person.id} className="yk-referral-person">
                <div className="yk-referral-person-heading">
                  <Link
                    href={`/profile/${encodeURIComponent(person.pseudo)}`}
                    className="yk-referral-identity"
                  >
                    <Avatar
                      name={person.pseudo}
                      image={person.avatarUrl ?? undefined}
                      size={44}
                    />
                    <span className="min-w-0">
                      <strong className="block break-words">
                        {person.pseudo}
                      </strong>
                      <span className="text-xs text-ink-3">
                        {t("settingsUi.viewProfile")}
                      </span>
                    </span>
                  </Link>
                  <span
                    className={`yk-referral-verification ${person.verifiedAt ? "is-verified" : ""}`}
                  >
                    {person.verifiedAt
                      ? t("settingsUi.verified")
                      : t("settingsUi.pendingVerification")}
                  </span>
                </div>
                <dl className="yk-referral-person-stats">
                  <div>
                    <dt>{t("settingsUi.boostersOpened")}</dt>
                    <dd>
                      {person.boostersOpened === null ? (
                        <span className="text-ink-3">
                          {t("profileUi.private")}
                        </span>
                      ) : (
                        fmt.number(person.boostersOpened)
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("settingsUi.accountCreated")}</dt>
                    <dd>
                      <ReferralDate value={person.accountCreatedAt} />
                    </dd>
                  </div>
                  <div>
                    <dt>{t("settingsUi.referredOn")}</dt>
                    <dd>
                      <ReferralDate value={person.referredAt} />
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          {page.total > page.limit && (
            <nav
              className="yk-referral-pagination"
              aria-label={t("settingsUi.referralPages")}
            >
              <Button
                type="button"
                disabled={offset === 0}
                onClick={() => changePage(Math.max(0, offset - page.limit))}
              >
                {t("settingsUi.previous")}{" "}
              </Button>
              <span className="text-xs text-ink-3">
                {t("settingsUi.referralPage", {
                  page: Math.floor(offset / page.limit) + 1,
                  total: Math.ceil(page.total / page.limit)
                })}
              </span>
              <Button
                type="button"
                disabled={offset + page.limit >= page.total}
                onClick={() => changePage(offset + page.limit)}
              >
                {t("packs.next")}{" "}
              </Button>
            </nav>
          )}
        </>
      ) : null}
    </div>
  );
}
