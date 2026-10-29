"use client";
import { gameErrorKey } from "@/i18n/game-messages";
/* eslint-disable @next/next/no-img-element -- GIPHY previews must remain animated. */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Modal } from "@/components/ui";
import { checkGifRating } from "@/lib/data/gif-rating";

export type GifChoice = {
  id: string;
  url: string;
  previewUrl: string;
  title: string;
  width: number;
  height: number;
};
type GiphyImage = { url: string; width: string; height: string };
type GiphyItem = {
  id: string;
  title: string;
  rating?: string;
  images: {
    fixed_width_small?: GiphyImage;
    fixed_width?: GiphyImage;
    original: GiphyImage;
  };
};
type GiphyResponse = {
  data: GiphyItem[];
  pagination?: { count: number; offset: number; total_count: number };
};

const PAGE_SIZE = 18;
// #379: never show a result rated above pg-13, whatever the API returns.
const ALLOWED_RATINGS = new Set(["g", "pg", "pg-13"]);
const GIF_CATEGORIES = [
  { label: "Trending", term: "" },
  { label: "Reactions", term: "reaction" },
  { label: "Anime", term: "anime" },
  { label: "Gaming", term: "gaming" },
  { label: "Sports", term: "sport" },
  { label: "Memes", term: "meme" }
];

const toChoice = (item: GiphyItem): GifChoice => {
  const preview =
    item.images.fixed_width_small ??
    item.images.fixed_width ??
    item.images.original;
  return {
    id: item.id,
    url: item.images.original.url,
    previewUrl: preview.url,
    title: item.title || "GIF",
    width: Number(item.images.original.width) || 1,
    height: Number(item.images.original.height) || 1
  };
};

export function GifPicker({
  disabled,
  onSelect
}: {
  disabled?: boolean;
  onSelect: (gif: GifChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [gifs, setGifs] = useState<GifChoice[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<GifChoice | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [rejected, setRejected] = useState(false);
  const t = useTranslations();
  const close = () => {
    setOpen(false);
    setSelected(null);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
      setOffset(0);
      setSelected(null);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const load = async () => {
      const key = process.env.NEXT_PUBLIC_GIPHY_API_KEY;
      if (!key) {
        setError("GIF search isn't configured.");
        setGifs([]);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const endpoint = debouncedQuery ? "search" : "trending";
        const params = new URLSearchParams({
          api_key: key,
          limit: String(PAGE_SIZE),
          offset: String(offset),
          rating: "pg-13",
          lang: "en",
          bundle: "messaging_non_clips"
        });
        if (debouncedQuery) params.set("q", debouncedQuery.slice(0, 50));
        const response = await fetch(
          `https://api.giphy.com/v1/gifs/${endpoint}?${params}`,
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error("GIPHY_UNAVAILABLE");
        const body = (await response.json()) as GiphyResponse;
        const next = body.data
          .filter(item => ALLOWED_RATINGS.has(item.rating?.toLowerCase() ?? ""))
          .map(toChoice);
        setGifs(current =>
          offset === 0
            ? next
            : [
                ...new Map(
                  [...current, ...next].map(gif => [gif.id, gif])
                ).values()
              ]
        );
        const count = body.pagination?.count ?? next.length;
        const total = body.pagination?.total_count;
        setHasMore(
          typeof total === "number"
            ? offset + count < total
            : count === PAGE_SIZE
        );
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === "AbortError"))
          setError("Couldn't load GIFs.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [open, debouncedQuery, offset]);

  const choose = (term: string) => {
    setQuery(term);
    setDebouncedQuery(term);
    setOffset(0);
  };
  const sendSelected = async () => {
    if (!selected || verifying) return;
    const choice = selected;
    setVerifying(true);
    setRejected(false);
    // The server records the rating the database checks on send.
    const verdict = await checkGifRating(choice.id);
    setVerifying(false);
    if (verdict === "rejected") {
      setRejected(true);
      return;
    }
    onSelect(choice);
    setOpen(false);
    setSelected(null);
    setQuery("");
    setDebouncedQuery("");
    setOffset(0);
  };

  return (
    <div className="yk-gif-picker">
      <button
        type="button"
        className="yk-gif-trigger"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(value => !value);
          setSelected(null);
        }}
      >
        GIF
      </button>
      <Modal
        open={open}
        onClose={close}
        title={t("profileUi.chooseAGIF")}
        className="yk-gif-modal"
      >
        <section className="yk-gif-panel">
          {!selected && (
            <>
              <div
                className="yk-gif-categories"
                aria-label={t("profileUi.gifcategories")}
              >
                {GIF_CATEGORIES.map(category => (
                  <button
                    type="button"
                    key={category.label}
                    className={
                      query === category.term ? "is-active" : undefined
                    }
                    onClick={() => choose(category.term)}
                  >
                    {t(`profileUi.gifCategory${category.label}`)}
                  </button>
                ))}
              </div>
              <label className="sr-only" htmlFor="auction-gif-search">
                {t("profileUi.searchGIFs")}{" "}
              </label>
              <div className="yk-gif-search">
                <span aria-hidden="true">⌕</span>
                <input
                  id="auction-gif-search"
                  type="search"
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder={t("profileUi.searchGIPHY")}
                />
                {query && (
                  <button
                    type="button"
                    aria-label={t("profileUi.clearSearch")}
                    onClick={() => setQuery("")}
                  >
                    ×
                  </button>
                )}
              </div>
              <div
                className="yk-gif-results"
                aria-busy={loading && offset === 0}
              >
                {gifs.map(gif => (
                  <button
                    type="button"
                    key={gif.id}
                    aria-label={t("profileUi.gifPreviewTitle", {
                      title: gif.title
                    })}
                    onClick={() => {
                      setSelected(gif);
                      setRejected(false);
                    }}
                  >
                    <img
                      src={gif.previewUrl}
                      alt={gif.title}
                      loading="lazy"
                      decoding="async"
                    />
                  </button>
                ))}
              </div>
              {loading && offset === 0 && (
                <div className="yk-gif-loading" role="status">
                  {t("profileUi.loadingGIFs")}{" "}
                </div>
              )}
              {!loading && !error && !gifs.length && (
                <p>{t("profileUi.noGIFsFound")}</p>
              )}
              {error && (
                <p role="alert">
                  {t(gameErrorKey(error, "profileUi.profileUnavailable"))}
                </p>
              )}
              {hasMore && !error && (
                <button
                  type="button"
                  className="yk-gif-more"
                  disabled={loading}
                  onClick={() => setOffset(value => value + PAGE_SIZE)}
                >
                  {loading ? t("packs.loading") : t("profileUi.loadMore")}
                </button>
              )}
            </>
          )}
          {selected && (
            <div
              className="yk-gif-preview"
              role="group"
              aria-label={t("profileUi.gifPreview")}
            >
              <img
                src={selected.previewUrl}
                alt={selected.title}
                decoding="async"
              />
              <div>
                <button
                  type="button"
                  autoFocus
                  onClick={() => setSelected(null)}
                >
                  {t("packs.cancel")}{" "}
                </button>
                <button
                  type="button"
                  disabled={verifying}
                  onClick={() => void sendSelected()}
                >
                  {verifying
                    ? t("gifPicker.checking")
                    : t("profileUi.sendThisGif")}
                </button>
              </div>
              {rejected && <p role="alert">{t("gifPicker.rejected")}</p>}
            </div>
          )}
          <a href="https://giphy.com" target="_blank" rel="noreferrer">
            {t("profileUi.poweredByGiphy")}
          </a>
        </section>
      </Modal>
    </div>
  );
}
