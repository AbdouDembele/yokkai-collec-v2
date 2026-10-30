"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { PaniniAlbumProgress } from "@/lib/data/cards";
import { binderIdentity } from "@/lib/ui/binder-identity";

export function LicenseRankingChoice({
  items,
  selected,
  loading,
  hasMore,
  onLoadMore,
  onSelect
}: {
  items: PaniniAlbumProgress[];
  selected: PaniniAlbumProgress | null;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onSelect: (item: PaniniAlbumProgress) => void;
}) {
  const t = useTranslations("communityRanking");
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    list = useRef<HTMLDivElement>(null);
  const moreRequested = useRef(false);
  const requestMore = () => {
    if (!loading && hasMore && !moreRequested.current) {
      moreRequested.current = true;
      onLoadMore();
    }
  };
  useEffect(() => {
    moreRequested.current = false;
  }, [items, loading]);
  useEffect(() => {
    if (!open) return;
    const options =
      list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
    const current = [...(options ?? [])].find(
      option => option.getAttribute("aria-selected") === "true"
    );
    (current ?? options?.[0] ?? list.current)?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !container.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);
  const choose = (item: PaniniAlbumProgress) => {
    onSelect(item);
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div className="yk-ranking-choice" ref={container}>
      <button
        id="ranking-license-select"
        type="button"
        ref={trigger}
        aria-labelledby="ranking-license-label ranking-license-value"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? "ranking-license-options" : undefined}
        disabled={!items.length && !selected}
        onClick={() => setOpen(value => !value)}
        onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span id="ranking-license-value">
          {selected?.license ?? t("chooseLicense")}
        </span>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div
          id="ranking-license-options"
          ref={list}
          role="listbox"
          tabIndex={-1}
          aria-labelledby="ranking-license-label"
          aria-busy={loading}
          onScroll={event => {
            const node = event.currentTarget;
            if (node.scrollHeight - node.scrollTop - node.clientHeight < 80)
              requestMore();
          }}
          onKeyDown={event => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              trigger.current?.focus();
              return;
            }
            if (event.key === "Tab") {
              setOpen(false);
              return;
            }
            const options = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="option"]'
              )
            ];
            const current = options.findIndex(
              option => option === document.activeElement
            );
            let next = current;
            if (event.key === "ArrowDown") {
              next = Math.min(options.length - 1, current + 1);
              if (current === options.length - 1) requestMore();
            } else if (event.key === "ArrowUp") next = Math.max(0, current - 1);
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") {
              next = options.length - 1;
              requestMore();
            } else return;
            event.preventDefault();
            options[next]?.focus();
          }}
        >
          {items.map(item => (
            <button
              key={binderIdentity(item)}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={
                !!selected && binderIdentity(item) === binderIdentity(selected)
              }
              onClick={() => choose(item)}
            >
              {item.license}
            </button>
          ))}
          {loading && <p role="status">{t("selectionLoading")}</p>}
          {!items.length && !loading && <p>{t("noLicenses")}</p>}
        </div>
      )}
    </div>
  );
}
