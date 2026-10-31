"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui";
import { RankingChoice } from "@/components/ranking-choice";
import { LicenseRankingChoice } from "@/components/license-ranking-choice";
import { RankingLicenseCover } from "@/components/ranking-license-cover";
import { StyledPlayerAvatar } from "@/components/styled-player-avatar";
import { StyledPlayerName } from "@/components/styled-player-name";
import { getGameInfo, type PaniniAlbumProgress } from "@/lib/data/cards";
import { binderIdentity } from "@/lib/ui/binder-identity";
import { getRankingLicenseChoices } from "@/lib/leaderboard/choices";
import {
  completionRatio,
  getLicenseLeaders,
  type CommunityRanking
} from "@/lib/leaderboard/community";

const categoryKey = (category: string) => category;

export function RankingLicenseExplorer({
  userId,
  revision = 0
}: {
  userId: string;
  revision?: number;
}) {
  const t = useTranslations("communityRanking"),
    common = useTranslations();
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [categoryError, setCategoryError] = useState(false);
  const [categoryRetry, setCategoryRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [choices, setChoices] = useState<{
    items: PaniniAlbumProgress[];
    total: number;
  }>({ items: [], total: 0 });
  const [choicesLoading, setChoicesLoading] = useState(true);
  const [choicesError, setChoicesError] = useState(false);
  const [choicesRetry, setChoicesRetry] = useState(0);
  const [selected, setSelected] = useState<PaniniAlbumProgress | null>(null);

  useEffect(() => {
    let active = true;
    void getGameInfo()
      .then(info => {
        if (active) {
          setCategories(
            [...new Set(info.categories)].sort((a, b) => a.localeCompare(b))
          );
          setCategoryError(false);
        }
      })
      .catch(() => {
        if (active) setCategoryError(true);
      });
    return () => {
      active = false;
    };
  }, [categoryRetry, userId]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        void getRankingLicenseChoices({
          query,
          category,
          page,
          pageSize: 72,
          signal: controller.signal
        })
          .then(next => {
            if (controller.signal.aborted) return;
            setChoices(current =>
              page === 1
                ? next
                : {
                    items: [
                      ...new Map(
                        [...current.items, ...next.items].map(item => [
                          binderIdentity(item),
                          item
                        ])
                      ).values()
                    ],
                    total: next.total
                  }
            );
            setChoicesLoading(false);
            setChoicesError(false);
          })
          .catch(() => {
            if (!controller.signal.aborted) {
              setChoicesLoading(false);
              setChoicesError(true);
            }
          });
      },
      query ? 200 : 0
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, category, page, choicesRetry, userId]);

  return (
    <div className="yk-license-explorer">
      <section
        className="yk-ranking-license-picker"
        aria-label={t("chooseLicense")}
        aria-busy={choicesLoading}
      >
        <label htmlFor="ranking-license-search">
          {t("licenseSearchLabel")}
        </label>
        <input
          id="ranking-license-search"
          type="search"
          value={query}
          maxLength={120}
          placeholder={t("licenseSearch")}
          onChange={event => {
            setQuery(event.target.value);
            setPage(1);
            setChoicesLoading(true);
          }}
        />
        <label id="ranking-category-label" htmlFor="ranking-category-select">
          {t("chooseCategory")}
        </label>
        <RankingChoice
          id="ranking-category-select"
          labelId="ranking-category-label"
          className="yk-ranking-category-choice"
          items={["", ...categories]}
          selected={category}
          getKey={categoryKey}
          getLabel={value => value || t("allCategories")}
          placeholder={t("allCategories")}
          onSelect={next => {
            if (next === category) return;
            setCategory(next);
            setPage(1);
            setQuery("");
            setSelected(null);
            setChoices({ items: [], total: 0 });
            setChoicesLoading(true);
            setChoicesError(false);
          }}
        />
        {categoryError && (
          <div role="alert">
            <p>{t("categoryFailed")}</p>
            <Button
              variant="secondary"
              onClick={() => setCategoryRetry(value => value + 1)}
            >
              {common("packs.tryAgain")}
            </Button>
          </div>
        )}
        <label id="ranking-license-label" htmlFor="ranking-license-select">
          {t("chooseLicense")}
        </label>
        <LicenseRankingChoice
          key={JSON.stringify([category, query])}
          category={category}
          query={query}
          items={choices.items}
          selected={selected}
          loading={choicesLoading}
          hasMore={choices.items.length < choices.total}
          onLoadMore={() => {
            setChoicesLoading(true);
            if (choicesError) setChoicesRetry(value => value + 1);
            else setPage(value => value + 1);
          }}
          onSelect={setSelected}
        />
        {choicesLoading && <p role="status">{t("selectionLoading")}</p>}
        {choicesError && (
          <div role="alert">
            <p>{t("selectionFailed")}</p>
            <Button
              variant="secondary"
              onClick={() => {
                setChoicesLoading(true);
                setChoicesRetry(value => value + 1);
              }}
            >
              {common("packs.tryAgain")}
            </Button>
          </div>
        )}
        {!choicesLoading && !choicesError && !choices.items.length && (
          <p role="status">{t("noLicenses")}</p>
        )}
      </section>
      {selected && (
        <LicenseLeaders
          key={binderIdentity(selected)}
          binder={selected}
          userId={userId}
          revision={revision}
          onClose={() => {
            setSelected(null);
            document.getElementById("ranking-license-select")?.focus();
          }}
        />
      )}
    </div>
  );
}

function LicenseLeaders({
  binder,
  userId,
  revision,
  onClose
}: {
  binder: PaniniAlbumProgress;
  userId: string;
  revision: number;
  onClose: () => void;
}) {
  const t = useTranslations("communityRanking"),
    common = useTranslations(),
    fmt = useFormatter();
  const [data, setData] = useState<CommunityRanking | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const key = binderIdentity(binder);
  useEffect(() => {
    const controller = new AbortController();
    void getLicenseLeaders(key, controller.signal)
      .then(next => {
        if (!controller.signal.aborted) {
          setData(next);
          setLoading(false);
          setError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(true);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [key, userId, revision, retry]);
  const total = data?.binder?.total ?? binder.total;
  const leaders = data?.entries ?? [];
  const value = leaders[0]?.value ?? 0;
  return (
    <section
      className="yk-license-leaders"
      aria-labelledby="license-leaders-title"
      aria-busy={loading}
    >
      <div className="yk-license-leaders-header">
        <RankingLicenseCover binder={binder} />
        <div className="yk-license-leaders-summary">
          <p className="eyebrow">{t("licenseLeaders")}</p>
          <h2 id="license-leaders-title">{binder.license}</h2>
          {!loading && !error && leaders.length > 0 && (
            <p className="yk-license-leaders-value">
              <strong>
                {fmt.number(completionRatio(value, total), {
                  style: "percent",
                  maximumFractionDigits: 1
                })}
              </strong>
              <span>{t("licenseLeaderCards", { owned: value, total })}</span>
            </p>
          )}
          <Button
            variant="secondary"
            className="yk-license-leaders-close"
            onClick={onClose}
          >
            {t("closeLicense")}
          </Button>
        </div>
      </div>
      <div className="yk-license-leaders-results">
        {loading && <p role="status">{t("loading")}</p>}
        {!loading && error && (
          <div role="alert">
            <p>{t("failed")}</p>
            <Button
              variant="secondary"
              onClick={() => {
                setLoading(true);
                setError(false);
                setRetry(value => value + 1);
              }}
            >
              {common("packs.tryAgain")}
            </Button>
          </div>
        )}
        {!loading && !error && data && (
          <>
            {leaders.length > 0 ? (
              <>
                <p className="yk-license-leaders-caption">
                  {t("leadersShown", { count: leaders.length })}
                </p>
                <ul
                  className="yk-license-leaders-list"
                  tabIndex={0}
                  aria-label={t("licenseLeadersList", {
                    license: binder.license
                  })}
                >
                  {leaders.map(entry => (
                    <li key={entry.userId}>
                      <Link
                        href={`/profile/${encodeURIComponent(entry.pseudo)}`}
                        className="yk-license-leader-player"
                      >
                        <StyledPlayerAvatar
                          cosmetics={data.profileStyles[entry.userId]}
                          name={entry.pseudo}
                          image={entry.avatarUrl ?? undefined}
                          size={42}
                        />
                        <span>
                          <StyledPlayerName
                            name={entry.pseudo}
                            cosmetics={data.profileStyles[entry.userId]}
                          />
                          {entry.userId === userId && (
                            <small>{common("homeLeaderboard.you")}</small>
                          )}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p role="status">{t("licenseLeadersEmpty")}</p>
            )}
          </>
        )}
      </div>
      {!loading && !error && data && (
        <>
          {data.mine && (
            <p className="yk-license-leaders-mine">
              {t("licenseYourCards", { owned: data.mine.value, total })}
            </p>
          )}
        </>
      )}
    </section>
  );
}
