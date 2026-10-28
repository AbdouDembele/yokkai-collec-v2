"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react";
import { Avatar, Button } from "@/components/ui";
import { StyledPlayerName } from "@/components/styled-player-name";
import { getReferralLeaderboard } from "@/lib/leaderboard/client";
import type { ReferralLeaderboard } from "@/lib/leaderboard/shared";

const number = (value: number) => value.toLocaleString("en-US");
const referrals = (value: number) =>
  `${number(value)} verified ${value === 1 ? "referral" : "referrals"}`;
type Request = { offset: number; query: string; friendsOnly: boolean };

export function ReferralLeaderboardView({
  userId,
  embedded = false,
  navigation
}: {
  userId: string;
  embedded?: boolean;
  navigation?: ReactNode;
}) {
  const [data, setData] = useState<ReferralLeaderboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [friendsOnly, setFriendsOnly] = useState(embedded);
  const request = useRef(0);
  const lastRequest = useRef<Request>({
    offset: 0,
    query: "",
    friendsOnly: embedded
  });
  const load = useCallback(async (options: Request) => {
    const current = ++request.current;
    lastRequest.current = options;
    setLoading(true);
    setError("");
    try {
      let next = await getReferralLeaderboard(
        options.offset,
        options.query,
        options.friendsOnly
      );
      if (
        options.offset > 0 &&
        !next.entries.length &&
        current === request.current
      ) {
        lastRequest.current = { ...options, offset: 0 };
        next = await getReferralLeaderboard(
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
            : "Couldn't load the referral leaderboard."
        );
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    const current = ++request.current;
    lastRequest.current = { offset: 0, query: "", friendsOnly: embedded };
    void getReferralLeaderboard(0, "", embedded)
      .then(next => {
        if (active && current === request.current) setData(next);
      })
      .catch(reason => {
        if (active && current === request.current)
          setError(
            reason instanceof Error
              ? reason.message
              : "Couldn't load the referral leaderboard."
          );
      })
      .finally(() => {
        if (active && current === request.current) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId, embedded]);
  const Root = embedded ? "section" : "main";
  const Heading = embedded ? "h2" : "h1";
  const Subheading = embedded ? "h3" : "h2";
  const mine = data?.mine;
  return (
    <Root
      id={embedded ? undefined : "main-content"}
      className={`yk-leaderboard${embedded ? " yk-leaderboard-social" : ""}`}
      aria-labelledby="referral-leaderboard-title"
    >
      <header className="yk-leaderboard-heading">
        <div>
          <p className="eyebrow">Grow the community</p>
          <Heading className="yk-title" id="referral-leaderboard-title">
            Referral leaderboard
          </Heading>
          <p>Bring friends. Climb together.</p>
        </div>
        <Button
          variant="secondary"
          onClick={() => void load(lastRequest.current)}
          disabled={loading}
        >
          Refresh rankings
        </Button>
      </header>
      {navigation}
      <section className="yk-leaderboard-mine" aria-label="Your referral rank">
        <div className="yk-leaderboard-emblem">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <circle cx="9" cy="7" r="3" />
            <path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v3" />
          </svg>
        </div>
        <div className="yk-leaderboard-personal">
          <span className="eyebrow">Your verified referrals</span>
          <strong>
            {mine ? number(mine.verifiedReferrals) : "—"}
            <small>
              {" "}
              {mine?.verifiedReferrals === 1 ? "referral" : "referrals"}
            </small>
          </strong>
          <p>
            {!mine
              ? error
                ? "Your referral rank is currently unavailable."
                : "Loading your referral rank…"
              : !mine.isPublic
                ? "Private profile · Your referral count is visible only to you."
                : mine.position
                  ? `Rank #${number(mine.position)} among ${number(data!.rankedPlayers)} public referrers`
                  : "Your first verified referral puts you on the leaderboard."}
          </p>
          <Link href="/settings#referrals">
            {mine && !mine.isPublic
              ? "Manage profile privacy & referral link →"
              : "Get your referral link →"}
          </Link>
        </div>
      </section>
      <div className="yk-leaderboard-layout">
        <section
          className="yk-leaderboard-board"
          aria-labelledby="referrers-title"
          aria-busy={loading}
        >
          <div className="yk-leaderboard-section-heading">
            <Subheading id="referrers-title">
              {friendsOnly
                ? "Friends referral leaderboard"
                : "Top 100 referrers"}
            </Subheading>
            <span>Verified referrals</span>
          </div>
          <p className="yk-leaderboard-note">
            {friendsOnly
              ? "You and your friends, ordered by global rank. Only public, ranked referrers appear."
              : "Most verified referrals first. Equal counts share the same rank."}
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
            <label htmlFor="referral-player-search">Find a referrer</label>
            <div>
              <input
                id="referral-player-search"
                type="search"
                maxLength={64}
                value={query}
                placeholder="Search by username…"
                aria-describedby="referral-search-help"
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
            <p id="referral-search-help">
              {friendsOnly
                ? "Search your ranked friends by username."
                : "Search all ranked referrers, including outside the top 100."}
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
            <>
              <p className="yk-leaderboard-loading" role="status">
                Updating referral rankings…
              </p>
              <div className="yk-leaderboard-skeleton" aria-hidden="true">
                {[1, 2, 3, 4, 5].map(i => (
                  <span key={i} />
                ))}
              </div>
            </>
          )}
          {data && !loading && !error && (
            <>
              <p className="yk-leaderboard-results" role="status">
                {number(data.total)}{" "}
                {data.total === 1 ? "referrer" : "referrers"}
                {data.query
                  ? ` found for “${data.query}”`
                  : data.friendsOnly
                    ? " in your friends view"
                    : " in the top 100"}
              </p>
              <ol
                className="yk-leaderboard-list"
                aria-label="Players ranked by verified referrals"
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
                      <Avatar
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
                        <span className="yk-leaderboard-variants">
                          {entry.position <= 3
                            ? "Top referrer"
                            : "Community referrer"}
                        </span>
                      </span>
                    </Link>
                    <span className="yk-leaderboard-points">
                      <strong>{number(entry.verifiedReferrals)}</strong>
                      <small>
                        {entry.verifiedReferrals === 1
                          ? "referral"
                          : "referrals"}
                      </small>
                    </span>
                  </li>
                ))}
              </ol>
              {!data.entries.length && (
                <p className="yk-leaderboard-message">
                  {data.query
                    ? "No ranked referrers found. Try another username."
                    : data.friendsOnly
                      ? "No ranked friends yet. Invite friends to get started."
                      : "No ranked referrers yet. Share your link and invite your first friend."}
                </p>
              )}
              {data.total > data.limit && (
                <nav
                  aria-label="Leaderboard pages"
                  className="yk-leaderboard-pagination"
                >
                  <Button
                    variant="secondary"
                    disabled={data.offset === 0}
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
                    disabled={data.offset + data.limit >= data.total}
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
        <aside
          className="yk-leaderboard-rules"
          aria-labelledby="referral-rules-title"
        >
          <div className="yk-leaderboard-section-heading">
            <Subheading id="referral-rules-title">
              How referral ranking works
            </Subheading>
          </div>
          <p>
            One verified referral = one count. The more verified friends you
            bring, the higher you rank.
          </p>
          <details open>
            <summary>What counts?</summary>
            <p>
              A friend must join through your referral link and verify their
              email. The referral must be validated by the reward system.
              Pending signups do not count.
            </p>
            <p>
              Each friend counts once. Deleted and banned accounts do not count.
              Cards, Karas, packs opened and Pro membership add no referral
              points.
            </p>
            {mine && (
              <p>
                You currently have {referrals(mine.verifiedReferrals)} counted
                in this leaderboard.
              </p>
            )}
          </details>
          <details open>
            <summary>Ranks &amp; privacy</summary>
            <p>
              Equal counts share a rank: 1, 2, 2, 4. Friends and search keep
              global positions within the public leaderboard.
            </p>
            <p>
              Only public, active referrers are ranked. Private counts are
              visible only to their owner. Blocked players are hidden without
              changing global positions.
            </p>
            <p>
              Only the total is public. Your referral link and the identities of
              your referrals stay private. The rank in Settings covers all
              active accounts; this leaderboard ranks eligible public profiles.
            </p>
          </details>
        </aside>
      </div>
    </Root>
  );
}
