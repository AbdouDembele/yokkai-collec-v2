"use client";

import Link from "next/link";
import { RankingGoal, RankingTrend } from "@/components/ranking-progress";
import { useRankingPlayerPreview } from "@/components/ranking-player-preview";
import { getRankingLicenseChoices } from "@/lib/leaderboard/choices";
import { RankingIcon } from "@/components/ranking-icon";
import { useEffect, useState, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui";
import { GlobalLicenseStats } from "@/components/global-license-stats";
import { RankingChoice } from "@/components/ranking-choice";
import { LicenseRankingChoice } from "@/components/license-ranking-choice";
import { StyledPlayerAvatar } from "@/components/styled-player-avatar";
import { StyledPlayerName } from "@/components/styled-player-name";
import { getGameInfo, type PaniniAlbumProgress } from "@/lib/data/cards";
import { stableBindersEnabled } from "@/lib/data/binders";
import { binderIdentity } from "@/lib/ui/binder-identity";
import {
  getCommunityRanking,
  completionRatio,
  type CommunityRanking,
  type CommunityRankingKind,
  type CommunityRankingRequest
} from "@/lib/leaderboard/community";

const categoryKey = (category: string) => category;

export function CommunityLeaderboardView({
  userId,
  kind,
  embedded = false,
  navigation
}: {
  userId: string;
  kind: CommunityRankingKind;
  embedded?: boolean;
  navigation?: ReactNode;
}) {
  const playerPreview = useRankingPlayerPreview();
  const t = useTranslations("communityRanking"),
    common = useTranslations(),
    fmt = useFormatter();
  const [data, setData] = useState<CommunityRanking | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<CommunityRankingRequest>({
    offset: 0,
    query: "",
    friendsOnly: embedded
  });
  const [licenseView, setLicenseView] = useState<"overall" | "license">(
    "overall"
  );
  const [licenseCategory, setLicenseCategory] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [categoryError, setCategoryError] = useState(false);
  const [categoryRetry, setCategoryRetry] = useState(0);
  const [selected, setSelected] = useState<PaniniAlbumProgress | null>(null);
  const [licenseQuery, setLicenseQuery] = useState(""),
    [licensePage, setLicensePage] = useState(1);
  const [choices, setChoices] = useState<{
    items: PaniniAlbumProgress[];
    total: number;
  }>({ items: [], total: 0 });
  const [licensesLoading, setLicensesLoading] = useState(kind === "licenses"),
    [licensesError, setLicensesError] = useState(false);
  const [licenseRetry, setLicenseRetry] = useState(0);
  const reload = (next = options) => {
    setLoading(true);
    setError(false);
    setOptions({ ...next });
  };

  useEffect(() => {
    if (kind !== "licenses" || licenseView !== "license") return;
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
  }, [kind, licenseView, categoryRetry, userId]);

  useEffect(() => {
    if (kind !== "licenses" || licenseView !== "license") return;
    let active = true;
    const timer = setTimeout(() => {
      void getRankingLicenseChoices({
        query: licenseQuery,
        category: licenseCategory,
        page: licensePage,
        pageSize: 72
      })
        .then(next => {
          if (!active) return;
          setChoices(current =>
            licensePage === 1
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
          setSelected(current => current ?? next.items[0] ?? null);
          setLicensesError(false);
          setLicensesLoading(false);
          if (!next.items.length) setLoading(false);
        })
        .catch(() => {
          if (active) {
            setLicensesError(true);
            setLicensesLoading(false);
            setLoading(false);
          }
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    kind,
    licenseView,
    licenseCategory,
    licenseQuery,
    licensePage,
    licenseRetry,
    userId
  ]);

  const isSpecificLicense = kind === "licenses" && licenseView === "license";
  const isGlobal = kind === "licenses" && !isSpecificLicense;
  const rankingKey =
    kind !== "licenses"
      ? ""
      : isSpecificLicense
        ? selected
          ? binderIdentity(selected)
          : ""
        : "global:completion-score" + (stableBindersEnabled() ? "" : ":legacy");
  useEffect(() => {
    if (isSpecificLicense && !rankingKey) return;
    let active = true;
    const run = async () => {
      try {
        let next = await getCommunityRanking(kind, options, rankingKey);
        if (options.offset > 0 && !next.entries.length && active)
          next = await getCommunityRanking(
            kind,
            { ...options, offset: 0 },
            rankingKey
          );
        if (active) {
          setData(next);
          setLoading(false);
        }
      } catch {
        if (active) {
          setData(null);
          setError(true);
          setLoading(false);
        }
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [kind, options, rankingKey, isSpecificLicense, userId]);

  const isLicense = kind === "licenses",
    mine = data?.mine,
    totalCards = data?.binder?.total ?? data?.catalogue?.totalCards ?? 0;
  const percent = (value: number) =>
    fmt.number(completionRatio(value, totalCards), {
      style: "percent",
      maximumFractionDigits: 1
    });
  const Root = embedded ? "section" : "main",
    Heading = embedded ? "h2" : "h1";
  return (
    <Root
      onClickCapture={playerPreview.onClickCapture}
      id={embedded ? undefined : "main-content"}
      className={`yk-leaderboard yk-community-ranking${embedded ? " yk-leaderboard-social" : ""}`}
      aria-labelledby="community-ranking-title"
      data-ranking={kind}
    >
      <header className="yk-leaderboard-heading">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <Heading className="yk-title" id="community-ranking-title">
            {t(isLicense ? "licensesTitle" : "likesTitle")}
          </Heading>
          <p>{t(isLicense ? "licensesIntro" : "likesIntro")}</p>
        </div>
        <Button
          variant="secondary"
          onClick={() => reload()}
          disabled={loading || (isSpecificLicense && !selected)}
        >
          {common("socialUi.refreshRankings")}
        </Button>
      </header>
      {navigation}

      {isLicense && (
        <div
          className="yk-leaderboard-scopes yk-ranking-modes"
          role="group"
          aria-label={t("licenseScope")}
        >
          {(["overall", "license"] as const).map(mode => (
            <Button
              key={mode}
              variant="secondary"
              aria-pressed={licenseView === mode}
              onClick={() => {
                setLicenseView(mode);
                setData(null);
                reload({ ...options, offset: 0 });
              }}
            >
              {t(mode === "overall" ? "globalTab" : "byLicense")}
            </Button>
          ))}
        </div>
      )}
      {isSpecificLicense && (
        <section
          className="yk-ranking-license-picker"
          aria-label={t("chooseLicense")}
          aria-busy={licensesLoading}
        >
          <label htmlFor="ranking-license-search">
            {t("licenseSearchLabel")}
          </label>
          <input
            id="ranking-license-search"
            type="search"
            value={licenseQuery}
            maxLength={120}
            placeholder={t("licenseSearch")}
            onChange={event => {
              setLicenseQuery(event.target.value);
              setLicensePage(1);
              setLicensesLoading(true);
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
            selected={licenseCategory}
            getKey={categoryKey}
            getLabel={category => category || t("allCategories")}
            placeholder={t("allCategories")}
            onSelect={category => {
              setLicenseCategory(category);
              setLicensePage(1);
              setLicenseQuery("");
              setSelected(null);
              setChoices({ items: [], total: 0 });
              setData(null);
              setLicensesLoading(true);
              setLicensesError(false);
              reload({ ...options, offset: 0 });
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
            key={JSON.stringify([licenseCategory, licenseQuery])}
            category={licenseCategory}
            query={licenseQuery}
            items={choices.items}
            selected={selected}
            loading={licensesLoading}
            hasMore={choices.items.length < choices.total}
            onLoadMore={() => {
              setLicensesLoading(true);
              if (licensesError) setLicenseRetry(value => value + 1);
              else setLicensePage(value => value + 1);
            }}
            onSelect={next => {
              setSelected(next);
              setData(null);
              reload({ ...options, offset: 0 });
            }}
          />
          {licensesLoading && <p role="status">{t("selectionLoading")}</p>}
          {licensesError && (
            <div role="alert">
              <p>{t("selectionFailed")}</p>
              <Button
                variant="secondary"
                onClick={() => {
                  setLicensesLoading(true);
                  setLicenseRetry(value => value + 1);
                }}
              >
                {common("packs.tryAgain")}
              </Button>
            </div>
          )}
          {!licensesLoading && !licensesError && !choices.items.length && (
            <p role="status">{t("noLicenses")}</p>
          )}
        </section>
      )}

      {(!isSpecificLicense || selected) && (
        <>
          <section
            className="yk-leaderboard-mine"
            aria-label={t(
              isGlobal
                ? "yourGlobalProgress"
                : isSpecificLicense
                  ? "yourProgress"
                  : "yourLikes"
            )}
            aria-busy={loading}
          >
            <div
              className="yk-leaderboard-emblem"
              data-ranking={kind}
              aria-hidden="true"
            >
              <RankingIcon kind={kind} />
            </div>
            <div className="yk-leaderboard-personal">
              <span className="eyebrow">
                {t(
                  isGlobal
                    ? "yourGlobalProgress"
                    : isSpecificLicense
                      ? "yourProgress"
                      : "yourLikes"
                )}
              </span>
              {isSpecificLicense && data?.binder && (
                <h2 className="yk-ranking-license-name">
                  {data.binder.license}
                </h2>
              )}
              {isGlobal ? (
                !loading &&
                mine && (
                  <GlobalLicenseStats
                    completionScore={
                      data?.metric === "completion-score"
                        ? mine.completionScore
                        : undefined
                    }
                    completed={mine.completedLicenses ?? 0}
                    cards={mine.distinctCards ?? 0}
                    totalLicenses={data?.catalogue?.totalLicenses ?? 0}
                    totalCards={totalCards}
                  />
                )
              ) : (
                <strong>
                  {loading || !mine
                    ? "—"
                    : isSpecificLicense
                      ? percent(mine.value)
                      : fmt.number(mine.value)}
                </strong>
              )}
              {!loading && mine && isSpecificLicense && totalCards > 0 && (
                <p>
                  {t("cardsCount", {
                    owned: fmt.number(mine.value),
                    total: fmt.number(totalCards)
                  })}
                </p>
              )}
              <p>
                {loading
                  ? t("loading")
                  : !mine
                    ? t("unavailable")
                    : !mine.isPublic
                      ? t("private")
                      : mine.position
                        ? t("rank", {
                            position: mine.position,
                            count: data!.rankedPlayers
                          })
                        : t(isLicense ? "noCards" : "notRanked")}
              </p>
              {mine && !mine.isPublic && (
                <Link href="/settings">
                  {common("socialUi.manageProfilePrivacy")}
                </Link>
              )}
            </div>
          </section>

          {!loading && data && (
            <>
              <RankingTrend history={data.history?.[userId]} />
              <RankingGoal
                kind={kind}
                userId={userId}
                mine={data.mine ?? undefined}
                entries={data.entries}
                binder={data.binder}
              />
            </>
          )}
          <div className="yk-leaderboard-layout">
            <section
              className="yk-leaderboard-board"
              aria-label={t("listLabel", { kind: isGlobal ? "global" : kind })}
              aria-busy={loading}
            >
              <div
                className="yk-leaderboard-scopes"
                role="group"
                aria-label={common("socialUi.leaderboardView")}
              >
                <Button
                  variant="secondary"
                  aria-pressed={!options.friendsOnly}
                  onClick={() =>
                    reload({ ...options, offset: 0, friendsOnly: false })
                  }
                >
                  {common("socialUi.top100")}
                </Button>
                <Button
                  variant="secondary"
                  aria-pressed={options.friendsOnly}
                  onClick={() =>
                    reload({ ...options, offset: 0, friendsOnly: true })
                  }
                >
                  {common("catalogueUi.friends")}
                </Button>
              </div>
              <form
                className="yk-leaderboard-search"
                onSubmit={event => {
                  event.preventDefault();
                  reload({ ...options, query, offset: 0 });
                }}
              >
                <label htmlFor="community-player-search">
                  {common("socialUi.findAPlayer")}
                </label>
                <div>
                  <input
                    id="community-player-search"
                    type="search"
                    maxLength={64}
                    value={query}
                    placeholder={common("socialUi.searchByUsername")}
                    onChange={event => setQuery(event.target.value)}
                  />
                  <Button type="submit" variant="secondary">
                    {common("socialUi.search")}
                  </Button>
                  {(query || options.query) && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setQuery("");
                        reload({ ...options, query: "", offset: 0 });
                      }}
                    >
                      {common("profileUi.clearSearch")}
                    </Button>
                  )}
                </div>
                <p>
                  {common(
                    options.friendsOnly
                      ? "socialUi.searchYourRankedFriendsByUsername"
                      : "socialUi.searchAllRankedPlayersIncludingOutsideThe"
                  )}
                </p>
              </form>
              {error && (
                <div className="yk-leaderboard-message" role="alert">
                  <p>{t("failed")}</p>
                  <Button variant="secondary" onClick={() => reload()}>
                    {common("packs.tryAgain")}
                  </Button>
                </div>
              )}
              {loading && (
                <p className="yk-leaderboard-loading" role="status">
                  {t("loading")}
                </p>
              )}
              {!loading && !error && data && (
                <>
                  <p className="yk-leaderboard-results" role="status">
                    {common("socialUi.collectionResults", {
                      count: data.total,
                      query: data.query,
                      scope: data.query
                        ? "search"
                        : data.friendsOnly
                          ? "friends"
                          : "top"
                    })}
                  </p>
                  <ol
                    className="yk-leaderboard-list"
                    aria-label={t("listLabel", {
                      kind: isGlobal ? "global" : kind
                    })}
                  >
                    {data.entries.map(entry => (
                      <li
                        key={entry.userId}
                        className={`${entry.userId === userId ? "is-you" : ""} ${entry.position <= 3 ? "is-podium" : ""}`}
                      >
                        <span
                          className="yk-leaderboard-position"
                          aria-label={common("socialUi.rank", {
                            position: entry.position
                          })}
                        >
                          #{fmt.number(entry.position)}
                        </span>
                        <Link
                          href={`/profile/${encodeURIComponent(entry.pseudo)}`}
                          className="yk-leaderboard-player"
                        >
                          <StyledPlayerAvatar
                            cosmetics={data.profileStyles[entry.userId]}
                            name={entry.pseudo}
                            image={entry.avatarUrl ?? undefined}
                            size={42}
                          />
                          <span>
                            <strong>
                              <StyledPlayerName
                                name={entry.pseudo}
                                cosmetics={data.profileStyles[entry.userId]}
                              />
                              <RankingTrend
                                compact
                                history={data.history?.[entry.userId]}
                              />
                              {entry.userId === userId && (
                                <small>{common("homeLeaderboard.you")}</small>
                              )}
                              {entry.isFriend && (
                                <small className="yk-leaderboard-friend">
                                  {common("socialUi.friend")}
                                </small>
                              )}
                            </strong>
                          </span>
                        </Link>
                        {isGlobal ? (
                          <GlobalLicenseStats
                            completionScore={
                              data.metric === "completion-score"
                                ? entry.completionScore
                                : undefined
                            }
                            completed={entry.completedLicenses ?? 0}
                            cards={entry.distinctCards ?? 0}
                            totalLicenses={data?.catalogue?.totalLicenses ?? 0}
                            totalCards={totalCards}
                            compact
                          />
                        ) : (
                          <>
                            <span className="yk-leaderboard-points">
                              <strong>
                                {isSpecificLicense
                                  ? percent(entry.value)
                                  : fmt.number(entry.value)}
                              </strong>
                              <small>
                                {isSpecificLicense
                                  ? t("cardsCount", {
                                      owned: fmt.number(entry.value),
                                      total: fmt.number(totalCards)
                                    })
                                  : t("likesNoun", { count: entry.value })}
                              </small>
                            </span>
                          </>
                        )}
                        {isSpecificLicense && (
                          <div className="yk-ranking-completion">
                            <progress
                              value={entry.value}
                              max={totalCards || 1}
                              aria-label={t("progressLabel", {
                                name: entry.pseudo,
                                owned: entry.value,
                                total: totalCards
                              })}
                            />
                            <span
                              className={
                                entry.value === totalCards && totalCards > 0
                                  ? "is-completed"
                                  : ""
                              }
                            >
                              {entry.value === totalCards && totalCards > 0
                                ? t("completed")
                                : t("remaining", {
                                    count: Math.max(0, totalCards - entry.value)
                                  })}
                            </span>
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                  {!data.entries.length && (
                    <p className="yk-leaderboard-message">{t("empty")}</p>
                  )}
                  {data.total > data.limit && (
                    <nav
                      aria-label={common("socialUi.leaderboardPages")}
                      className="yk-leaderboard-pagination"
                    >
                      <Button
                        variant="secondary"
                        disabled={data.offset === 0}
                        onClick={() =>
                          reload({
                            ...options,
                            offset: Math.max(0, data.offset - data.limit)
                          })
                        }
                      >
                        {common("settingsUi.previous")}
                      </Button>
                      <span>
                        {common("socialUi.page", {
                          page: Math.floor(data.offset / data.limit) + 1,
                          total: Math.ceil(data.total / data.limit)
                        })}
                      </span>
                      <Button
                        variant="secondary"
                        disabled={data.offset + data.limit >= data.total}
                        onClick={() =>
                          reload({
                            ...options,
                            offset: data.offset + data.limit
                          })
                        }
                      >
                        {common("packs.next")}
                      </Button>
                    </nav>
                  )}
                </>
              )}
            </section>
            <aside className="yk-leaderboard-rules">
              <h2>{t("rules")}</h2>
              <p>
                {t(
                  isGlobal
                    ? "globalRules"
                    : isSpecificLicense
                      ? "licenseRules"
                      : "likesRules"
                )}
              </p>
              {isGlobal && data?.completionWeights && (
                <>
                  <h3>{t("completionWeightsTitle")}</h3>
                  <dl className="yk-completion-weights">
                    {(["C", "R", "SR", "SSR", "LR"] as const).map(rarity => (
                      <div key={rarity}>
                        <dt>{rarity}</dt>
                        <dd>{data.completionWeights?.[rarity]}</dd>
                      </div>
                    ))}
                  </dl>
                  <p>{t("completionScoredCards")}</p>
                </>
              )}
              <p>{t("privacyRules")}</p>
              {isLicense && <p>{t("currentRules")}</p>}
            </aside>
          </div>
        </>
      )}
      {playerPreview.preview}
    </Root>
  );
}
