"use client";
import { useTranslations, useFormatter } from "next-intl";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import { changePage, resolvePage } from "@/lib/ui/pagination";

export function Pagination({
  page,
  pageCount,
  onPageChange,
  scrollTargetId
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  scrollTargetId?: string;
}) {
  const tu = useTranslations("collectionShared");
  const format = useFormatter();
  const id = useId();
  const nav = useRef<HTMLElement>(null);
  const pending = useRef<number | null>(null);
  const active = Math.max(1, Math.min(page, pageCount));
  const [draft, setDraft] = useState({ page: active, text: String(active) });
  const value = draft.page === active ? draft.text : String(active);
  const [previous, setPrevious] = useState(active);
  if (previous !== active) {
    setPrevious(active);
    setDraft({ page: active, text: String(active) });
  }
  useEffect(() => {
    pending.current = null;
  }, [active]);
  useEffect(() => {
    const list = scrollTargetId
      ? document.getElementById(scrollTargetId)
      : null;
    list?.addEventListener("keydown", keyboard);
    return () => list?.removeEventListener("keydown", keyboard);
  });

  function go(value: string) {
    const next = resolvePage(value, active, pageCount);
    setDraft({ page: active, text: String(next) });
    if (pending.current === next) return;
    changePage(String(next), active, pageCount, target => {
      pending.current = target;
      onPageChange(target);
      const list = scrollTargetId
        ? document.getElementById(scrollTargetId)
        : nav.current?.closest("section");
      list?.scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth"
      });
    });
  }

  function keyboard(event: KeyboardEvent | ReactKeyboardEvent) {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      (event.target as HTMLElement).closest(
        "input, textarea, select, [contenteditable]"
      )
    )
      return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      go(String(active + (event.key === "ArrowRight" ? 1 : -1)));
    }
  }

  if (pageCount <= 1) return null;
  const controls = [
    [tu("firstPage"), "«", 1, active === 1],
    [tu("previousPage"), "‹", active - 1, active === 1],
    [tu("nextPage"), "›", active + 1, active >= pageCount],
    [tu("lastPage"), "»", pageCount, active >= pageCount]
  ] as const;
  const button = (index: number) => {
    const [label, glyph, target, disabled] = controls[index];
    return (
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={() => go(String(target))}
        className="yk-page-button"
      >
        <span aria-hidden="true">{glyph}</span>
      </button>
    );
  };
  return (
    <nav
      ref={nav}
      aria-label={tu("pagination")}
      tabIndex={0}
      className="yk-pagination"
      onKeyDown={keyboard}
    >
      <div className="yk-pagination-controls">
        {button(0)}
        {button(1)}
        <div className="yk-page-entry">
          <span>{tu("page")}</span>
          <label htmlFor={id} className="sr-only">
            {tu("goToPage")}
          </label>
          <input
            id={id}
            inputMode="numeric"
            type="text"
            autoComplete="off"
            value={value}
            onFocus={event => event.currentTarget.select()}
            onChange={event =>
              setDraft({ page: active, text: event.target.value })
            }
            onBlur={event => go(event.currentTarget.value)}
            onKeyDown={event => {
              if (event.key === "Enter") {
                event.preventDefault();
                go(event.currentTarget.value);
              }
            }}
          />
          <span>
            {tu("of")}
            {format.number(pageCount)}
          </span>
        </div>
        {button(2)}
        {button(3)}
      </div>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {tu("pageTrailingSpace")}
        {format.number(active)}
        {tu("ofLeadingSpace")} {format.number(pageCount)}
      </span>
    </nav>
  );
}
