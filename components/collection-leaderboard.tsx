"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";
import { Button } from "@/components/ui";
import { StyledPlayerAvatar } from "@/components/styled-player-avatar";
import { StyledPlayerName } from "@/components/styled-player-name";
import {
  LeaderboardStatIcon,
  LeaderboardRarityBadge,
  LeaderboardStats
} from "@/components/leaderboard-stats";
import { getCollectionLeaderboard } from "@/lib/leaderboard/client";
import {
  COLLECTION_SCORE_RULES,
  type CollectionLeaderboard
} from "@/lib/leaderboard/shared";

const number = (value: number) => value.toLocaleString("en-US");
const quantity = (value: number, singular: string, plural = singular + "s") =>
  `${number(value)} ${value === 1 ? singular : plural}`;
type LeaderboardRequest = {
  offset: number;
  query: string;
  friendsOnly: boolean;
};

function Trophy() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d="M8 3h8v6a4 4 0 0 1-8 0V3ZM8 5H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4M12 13v5m-4 3h8m-7-3h6v3H9z" />
    </svg>
  );
}

export function CollectionLeaderboardView({
  userId,
  embedded = false,
  navigation
}: {
  userId: string;
  embedded?: boolean;
  navigation?: ReactNode;
}) {
  const [data, setData] = useState<CollectionLeaderboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [friendsOnly, setFriendsOnly] = useState(embedded);
  const request = useRef(0);
  const lastRequest = useRef<LeaderboardRequest>({
    offset: 0,
    query: "",
    friendsOnly: embedded
  });
  const load = useCallback(async (options: LeaderboardRequest) => {
    const current = ++request.current;
    lastRequest.current = options;
    setLoading(true);
    setError("");
    try {
      let next = await getCollectionLeaderboard(
        options.offset,
        options.query,
        options.friendsOnly
      );
      // Holdings/visibility can change between pages. Recover from a removed last page.
      if (
        options.offset > 0 &&
        !next.entries.length &&
        current === request.current
      ) {
        lastRequest.current = { ...options, offset: 0 };
        next = await getCollectionLeaderboard(
          0,
          options.query,
          options.friendsOnly
        );
      }
      if (current === request.current) setData(next);
    } catch (reason) {
      if (current === request.current)
        setError(
          reason instanceof Error
            ? reason.message
            : "Couldn't load the leaderboard."
        );
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    const current = ++request.current;
    // Only the completed external request updates state on initial mount.
    lastRequest.current = { offset: 0, query: "", friendsOnly: embedded };
    void getCollectionLeaderboard(0, "", embedded)
      .then(next => {
        if (active && current === request.current) setData(next);
      })
      .catch(reason => {
        if (active && current === request.current)
          setError(
            reason instanceof Error
              ? reason.message
              : "Couldn't load the leaderboard."
          );
      })
      .finally(() => {
        if (active && current === request.current) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId, embedded]);

  const mine = data?.mine;
  const myCounts = data?.cardCounts?.[userId];
  const Root = embedded ? "section" : "main";
  const Heading = embedded ? "h2" : "h1";
  const Subheading = embedded ? "h3" : "h2";
  return (
    <Root
      id={embedded ? undefined : "main-content"}
      className={`yk-leaderboard${embedded ? " yk-leaderboard-social" : ""}`}
      aria-labelledby="leaderboard-title"
    >
      <header className="yk-leaderboard-heading">
        <div>
          <p className="eyebrow">Every rare find counts</p>
          <Heading className="yk-title" id="leaderboard-title">
            Collection leaderboard
          </Heading>
          <p>Build a collection worth climbing for.</p>
        </div>
        <Button
          variant="secondary"
          onClick={() => void load(lastRequest.current)}
          disabled={loading}
        >
          Refresh scores
        </Button>
      </header>

      {navigation}

      <section
        className="yk-leaderboard-mine"
        aria-label="Your collection score"
      >
        <div className="yk-leaderboard-emblem">
          <Trophy />
        </div>
        <div className="yk-leaderboard-personal">
          <span className="eyebrow">Your collection score</span>
          <strong>
            {mine ? number(mine.score) : "—"}
            <small> points</small>
          </strong>
          <p>
            {!mine
              ? error
                ? "Your score is currently unavailable."
                : "Loading your collection score…"
              : !mine.isPublic
                ? "Private profile · Your score is visible only to you."
                : mine.position
                  ? `Rank #${number(mine.position)} among ${number(data!.rankedPlayers)} collectors`
                  : "Collect your first card to enter the rankings."}
          </p>
          {mine && !mine.isPublic && (
            <Link href="/settings">Manage profile privacy →</Link>
          )}
        </div>
        {mine && (
          <dl className="yk-leaderboard-counts">
            {(["sr", "ssr", "lr"] as const).map(rarity => (
              <div key={rarity} data-stat={rarity}>
                <dt>
                  <LeaderboardRarityBadge rarity={rarity.toUpperCase()} />
                  <span className="sr-only"> cards</span>
                </dt>
                <dd>{myCounts ? number(myCounts[rarity]) : "—"}</dd>
              </div>
            ))}
            <div data-stat="infinity">
              <dt>
                <LeaderboardStatIcon kind="infinity" />
                Infinity
              </dt>
              <dd>{myCounts ? number(myCounts.infinity) : "—"}</dd>
            </div>
            <div data-stat="shiny">
              <dt>
                <LeaderboardStatIcon kind="shiny" />
                Shiny
              </dt>
              <dd>{myCounts ? number(myCounts.shiny) : "—"}</dd>
            </div>
          </dl>
        )}
      </section>

      <div className="yk-leaderboard-layout">
        <section
          className="yk-leaderboard-board"
          aria-labelledby="collectors-title"
          aria-busy={loading}
        >
          <div className="yk-leaderboard-section-heading">
            <Subheading id="collectors-title">
              {friendsOnly ? "Friends leaderboard" : "Top 100 collectors"}
            </Subheading>
            <span>Current collection · Score v1</span>
          </div>
          <p className="yk-leaderboard-note">
            {friendsOnly
              ? "You and your friends, ordered by global rank. Only public, ranked collections appear."
              : "Public profiles only. Equal scores share the same rank."}
          </p>
          <div
            className="yk-leaderboard-scopes"
            role="group"
            aria-label="Leaderboard view"
          >
            <Button
              variant="secondary"
              aria-pressed={!friendsOnly}
              onClick={() => {
                setFriendsOnly(false);
                void load({ offset: 0, query, friendsOnly: false });
              }}
            >
              Top 100
            </Button>
            <Button
              variant="secondary"
              aria-pressed={friendsOnly}
              onClick={() => {
                setFriendsOnly(true);
                void load({ offset: 0, query, friendsOnly: true });
              }}
            >
              Friends
            </Button>
          </div>
          <form
            className="yk-leaderboard-search"
            onSubmit={event => {
              event.preventDefault();
              void load({ offset: 0, query, friendsOnly });
            }}
          >
            <label htmlFor="leaderboard-player-search">Find a player</label>
            <div>
              <input
                id="leaderboard-player-search"
                type="search"
                maxLength={64}
                value={query}
                placeholder="Search by username…"
                aria-describedby="leaderboard-search-help"
                onChange={event => setQuery(event.target.value)}
              />
              <Button type="submit" variant="secondary">
                Search
              </Button>
              {(query || data?.query) && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQuery("");
                    void load({ offset: 0, query: "", friendsOnly });
                  }}
                >
                  Clear search
                </Button>
              )}
            </div>
            <p id="leaderboard-search-help">
              {friendsOnly
                ? "Search your ranked friends by username."
                : "Search all ranked players, including outside the top 100."}
            </p>
          </form>
          {error && (
            <div className="yk-leaderboard-message" role="alert">
              <p>{error}</p>
              <Button
                variant="secondary"
                onClick={() => void load(lastRequest.current)}
                disabled={loading}
              >
                Try again
              </Button>
            </div>
          )}
          {loading && (
            <p className="yk-leaderboard-loading" role="status">
              Updating collection scores…
            </p>
          )}
          {loading && (
            <div className="yk-leaderboard-skeleton" aria-hidden="true">
              {[1, 2, 3, 4, 5].map(i => (
                <span key={i} />
              ))}
            </div>
          )}
          {data && !loading && !error && (
            <>
              <p className="yk-leaderboard-results" role="status">
                {data.query
                  ? `${quantity(data.total, "player")} found for “${data.query}”`
                  : `${quantity(data.total, "collector")} ${data.friendsOnly ? "in your friends view" : "in the top 100"}`}
              </p>
              <ol
                className="yk-leaderboard-list"
                aria-label="Collectors ranked by score"
              >
                {data.entries.map(entry => (
                  <li
                    key={entry.userId}
                    className={`${entry.userId === userId ? "is-you" : ""} ${entry.position <= 3 ? "is-podium" : ""}`}
                  >
                    <span
                      className="yk-leaderboard-position"
                      aria-label={`Rank ${entry.position}`}
                    >
                      #{number(entry.position)}
                    </span>
                    <Link
                      href={`/profile/${encodeURIComponent(entry.pseudo)}`}
                      className="yk-leaderboard-player"
                    >
                      <StyledPlayerAvatar
                        cosmetics={data.profileStyles?.[entry.userId]}
                        name={entry.pseudo}
                        image={entry.avatarUrl ?? undefined}
                        size={42}
                      />
                      <span>
                        <strong>
                          <StyledPlayerName
                            name={entry.pseudo}
                            cosmetics={data.profileStyles?.[entry.userId]}
                          />
                          {entry.userId === userId && <small> You</small>}
                          {entry.isFriend && (
                            <small className="yk-leaderboard-friend">
                              Friend
                            </small>
                          )}
                        </strong>
                        <LeaderboardStats
                          counts={data.cardCounts?.[entry.userId]}
                        />
                      </span>
                    </Link>
                    <span className="yk-leaderboard-points">
                      <strong>{number(entry.score)}</strong>
                      <small>points</small>
                    </span>
                  </li>
                ))}
              </ol>
              {!data.entries.length && !loading && !error && (
                <p className="yk-leaderboard-message">
                  {data.query
                    ? "No ranked players found. Try another username."
                    : data.friendsOnly
                      ? "No ranked friends yet. Friends with public collections will appear here."
                      : "No ranked collections yet. Collect a card and make your profile public to join."}
                </p>
              )}
              {data.total > data.limit && (
                <nav
                  aria-label="Leaderboard pages"
                  className="yk-leaderboard-pagination"
                >
                  <Button
                    variant="secondary"
                    disabled={loading || data.offset === 0}
                    onClick={() =>
                      void load({
                        offset: Math.max(0, data.offset - data.limit),
                        query: data.query,
                        friendsOnly: data.friendsOnly
                      })
                    }
                  >
                    Previous
                  </Button>
                  <span>
                    Page {number(Math.floor(data.offset / data.limit) + 1)} of{" "}
                    {number(Math.ceil(data.total / data.limit))}
                  </span>
                  <Button
                    variant="secondary"
                    disabled={loading || data.offset + data.limit >= data.total}
                    onClick={() =>
                      void load({
                        offset: data.offset + data.limit,
                        query: data.query,
                        friendsOnly: data.friendsOnly
                      })
                    }
                  >
                    Next
                  </Button>
                </nav>
              )}
            </>
          )}
        </section>

        <aside className="yk-leaderboard-rules" aria-labelledby="score-title">
          <div className="yk-leaderboard-section-heading">
            <Subheading id="score-title">How scoring works</Subheading>
          </div>
          <p>Points for the first copy of each card and variant.</p>
          <dl className="yk-leaderboard-values">
            {COLLECTION_SCORE_RULES.map(rule => (
              <div key={rule.label} data-kind={rule.kind}>
                <dt className="yk-leaderboard-rarity-label">
                  <LeaderboardRarityBadge rarity={rule.label.split(" ")[0]} />
                  {(rule.kind === "infinity" || rule.kind === "shiny") && (
                    <>
                      <LeaderboardStatIcon kind={rule.kind} />
                      <span>
                        {rule.kind === "infinity" ? "Infinity" : "Shiny"}
                      </span>
                    </>
                  )}
                </dt>
                <dd>{number(rule.points)}</dd>
              </div>
            ))}
          </dl>
          <details open>
            <summary>Duplicates &amp; evolution</summary>
            <p>
              SR, SSR and LR totals include every owned copy. Infinity and Shiny
              counts are included in their base rarity totals.
            </p>
            <p>
              First copy: 100%. Copies 2–5: 20% each. Further identical copies:
              0 points. Different cards and variants count separately.
            </p>
            <p>
              Infinity values reflect the fusion cost plus 20%: 5 SSR or 3 LR. A
              natural LR Shiny is worth 10× a standard LR.
            </p>
            <p>
              For example, five copies of the same LR earn 9,000 points. Two
              different LR cards earn 10,000 points.
            </p>
          </details>
          <details>
            <summary>Fair play &amp; privacy</summary>
            <p>
              Only cards currently owned count. Trades and sales move points
              with the cards. Locked and auction-listed cards count until
              ownership changes. Pending Decision Pack choices do not count.
            </p>
            <p>
              No bonuses for Karas, account age, custom art or Pro membership.
              Private, deleted and banned profiles are not ranked. Blocked
              players are hidden; global rank numbers stay unchanged.
            </p>
            <p>
              Evolving into a variant you already own is subject to the same
              duplicate cap. This can lower your score when consumed variants
              disappear.
            </p>
          </details>
          {mine && (
            <details>
              <summary>Your score breakdown</summary>
              {mine.breakdown.length ? (
                <dl className="yk-leaderboard-values">
                  {mine.breakdown.map(row => (
                    <div key={`${row.rarity}-${row.variant}`}>
                      <dt>
                        {row.rarity}
                        {row.variant === "standard"
                          ? ""
                          : row.variant === "infinity"
                            ? " Infinity"
                            : " Shiny"}
                        <small>
                          {quantity(row.uniqueVariants, "variant")} ·{" "}
                          {quantity(row.copies, "copy", "copies")} ·{" "}
                          {quantity(row.duplicatePoints, "duplicate point")}
                        </small>
                      </dt>
                      <dd>{number(row.points)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p>
                  Your score breakdown will appear after you collect a card.
                </p>
              )}
            </details>
          )}
        </aside>
      </div>
    </Root>
  );
}
