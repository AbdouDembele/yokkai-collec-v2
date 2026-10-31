"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui";
import { RankingChoice } from "@/components/ranking-choice";
import { LicenseRankingChoice } from "@/components/license-ranking-choice";
import { getGameInfo, type PaniniAlbumProgress } from "@/lib/data/cards";
import { binderIdentity } from "@/lib/ui/binder-identity";
import { getRankingLicenseChoices } from "@/lib/leaderboard/choices";

const categoryKey = (category: string) => category;

export function RankingLicenseExplorer({
  userId,
  revision = 0,
  selected,
  onSelect
}: {
  userId: string;
  revision?: number;
  selected: PaniniAlbumProgress | null;
  onSelect: (binder: PaniniAlbumProgress | null) => void;
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
  }, [query, category, page, choicesRetry, userId, revision]);

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
            onSelect(null);
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
          onSelect={onSelect}
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
        <Button variant="secondary" onClick={() => onSelect(null)}>
          {t("showAllLicenses")}
        </Button>
      )}
    </div>
  );
}
