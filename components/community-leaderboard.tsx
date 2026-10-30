"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui";
import { StyledPlayerAvatar } from "@/components/styled-player-avatar";
import { StyledPlayerName } from "@/components/styled-player-name";
import {
  getPaniniAlbumsPage,
  type PaniniAlbumProgress
} from "@/lib/data/cards";
import { binderIdentity } from "@/lib/ui/binder-identity";
import {
  getCommunityRanking,
  completionRatio,
  type CommunityRanking,
  type CommunityRankingKind,
  type CommunityRankingRequest
} from "@/lib/leaderboard/community";

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
    if (kind !== "licenses") return;
    let active = true;
    const timer = setTimeout(() => {
      void getPaniniAlbumsPage({
        query: licenseQuery,
        page: licensePage,
        pageSize: 24
      })
        .then(next => {
          if (!active) return;
          setChoices(next);
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
  }, [kind, licenseQuery, licensePage, licenseRetry, userId]);

  useEffect(() => {
    if (kind === "licenses" && !selected) return;
    let active = true;
    const run = async () => {
      try {
        let next = await getCommunityRanking(
          kind,
          options,
          selected ? binderIdentity(selected) : ""
        );
        if (options.offset > 0 && !next.entries.length && active)
          next = await getCommunityRanking(
            kind,
            { ...options, offset: 0 },
            selected ? binderIdentity(selected) : ""
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
  }, [kind, options, selected, userId]);

  const isLicense = kind === "licenses",
    mine = data?.mine,
    totalCards = data?.binder?.total ?? 0;
  const percent = (value: number) =>
    fmt.number(completionRatio(value, totalCards), {
      style: "percent",
      maximumFractionDigits: 1
    });
  const Root = embedded ? "section" : "main",
    Heading = embedded ? "h2" : "h1";
  const chosenInPage =
    selected &&
    choices.items.some(
      item => binderIdentity(item) === binderIdentity(selected)
    );
  return (
    <Root
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
          disabled={loading || (isLicense && !selected)}
        >
          {common("socialUi.refreshRankings")}
        </Button>
      </header>
      {navigation}

      {isLicense && (
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
          <label htmlFor="ranking-license-select">{t("chooseLicense")}</label>
          <select
            id="ranking-license-select"
            value={selected ? binderIdentity(selected) : ""}
            disabled={!choices.items.length && !selected}
            onChange={event => {
              const next = choices.items.find(
                item => binderIdentity(item) === event.target.value
              );
              if (next) {
                setSelected(next);
                setData(null);
                reload({ ...options, offset: 0 });
              }
            }}
          >
            {!selected && <option value="">{t("chooseLicense")}</option>}
            {selected && !chosenInPage && (
              <option value={binderIdentity(selected)}>
                {selected.license}
              </option>
            )}
            {choices.items.map(item => (
              <option key={binderIdentity(item)} value={binderIdentity(item)}>
                {item.license}
              </option>
            ))}
          </select>
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
          {choices.total > 24 && (
            <nav
              className="yk-leaderboard-pagination"
              aria-label={t("licensePages")}
            >
              <Button
                variant="secondary"
                disabled={licensesLoading || licensePage === 1}
                onClick={() => {
                  setLicensesLoading(true);
                  setLicensePage(value => value - 1);
                }}
              >
                {common("settingsUi.previous")}
              </Button>
              <span>
                {common("socialUi.page", {
                  page: licensePage,
                  total: Math.ceil(choices.total / 24)
                })}
              </span>
              <Button
                variant="secondary"
                disabled={licensesLoading || licensePage * 24 >= choices.total}
                onClick={() => {
                  setLicensesLoading(true);
                  setLicensePage(value => value + 1);
                }}
              >
                {common("packs.next")}
              </Button>
            </nav>
          )}
        </section>
      )}

      {(!isLicense || selected) && (
        <>
          <section
            className="yk-leaderboard-mine"
            aria-label={t(isLicense ? "yourProgress" : "yourLikes")}
            aria-busy={loading}
          >
            <div className="yk-leaderboard-personal">
              <span className="eyebrow">
                {t(isLicense ? "yourProgress" : "yourLikes")}
              </span>
              {isLicense && data?.binder && (
                <h2 className="yk-ranking-license-name">
                  {data.binder.license}
                </h2>
              )}
              <strong>
                {loading || !mine
                  ? "—"
                  : isLicense
                    ? percent(mine.value)
                    : fmt.number(mine.value)}
              </strong>
              {!loading && mine && isLicense && totalCards > 0 && (
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

          <div className="yk-leaderboard-layout">
            <section
              className="yk-leaderboard-board"
              aria-label={t("listLabel", { kind })}
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
                    aria-label={t("listLabel", { kind })}
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
                        <span className="yk-leaderboard-points">
                          <strong>
                            {isLicense
                              ? percent(entry.value)
                              : fmt.number(entry.value)}
                          </strong>
                          <small>
                            {isLicense
                              ? t("cardsCount", {
                                  owned: fmt.number(entry.value),
                                  total: fmt.number(totalCards)
                                })
                              : t("likesNoun", { count: entry.value })}
                          </small>
                        </span>
                        {isLicense && (
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
              <p>{t(isLicense ? "licenseRules" : "likesRules")}</p>
              <p>{t("privacyRules")}</p>
              {isLicense && <p>{t("currentRules")}</p>}
            </aside>
          </div>
        </>
      )}
    </Root>
  );
}
