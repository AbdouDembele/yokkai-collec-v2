"use client";
import { useTranslations } from "next-intl";

import { useEffect, useId, useRef, useState } from "react";
import { Modal } from "@/components/ui";
import { REACTION_EMOJIS } from "@/lib/ui/reaction-emojis";

export function EmojiReactionPicker({
  disabled,
  selected,
  onSelect
}: {
  disabled: boolean;
  selected: string[];
  onSelect: (emoji: string) => void;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const searchId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  function close() {
    restoreFocus.current = true;
    setOpen(false);
  }
  useEffect(() => {
    if (open || disabled || !restoreFocus.current) return;
    const frame = requestAnimationFrame(() => {
      restoreFocus.current = false;
      trigger.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, disabled]);
  const filtered = REACTION_EMOJIS.filter(
    item =>
      (category === "All" || category === item.group) &&
      `${item.label} ${item.id} ${item.emoji}`
        .toLowerCase()
        .includes(query.trim().toLowerCase())
  );
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="yk-add-reaction"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("profileUi.addEmojiReaction")}
        onClick={() => {
          setOpen(true);
          setQuery("");
          setCategory("All");
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M19 13a8 8 0 1 1-8-9" />
          <path d="M8 13s1 2 4 2 4-2 4-2M8 9h.01M14 9h.01M18 3v6M15 6h6" />
        </svg>
        <span>{t("profileUi.react")}</span>
      </button>
      <Modal
        open={open}
        onClose={close}
        title={t("profileUi.pickYourReaction")}
        className="yk-reaction-modal"
      >
        <p className="yk-reaction-intro">
          {t("profileUi.reactionPickerHint")}{" "}
        </p>
        <label htmlFor={searchId} className="sr-only">
          {t("profileUi.searchReactions")}{" "}
        </label>
        <input
          id={searchId}
          type="search"
          className="auth-input yk-reaction-search"
          placeholder={t("profileUi.searchEmojis")}
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
        <div
          className="yk-reaction-categories"
          aria-label={t("profileUi.emojiCategories")}
        >
          {["All", "Popular", "Faces", "Celebrate"].map(group => (
            <button
              type="button"
              key={group}
              aria-pressed={category === group}
              onClick={() => setCategory(group)}
            >
              {t(`profileUi.emojiGroup${group}`)}
            </button>
          ))}
        </div>
        <div
          className="yk-reaction-grid"
          aria-label={t("profileUi.emojiReactions")}
        >
          {filtered.map(item => (
            <button
              type="button"
              key={item.id}
              title={t(
                `profileUi.emoji${item.id.replace(/(^|-)(\w)/g, (_, _separator, letter: string) => letter.toUpperCase())}`
              )}
              aria-label={t("profileUi.reactWith", {
                label: t(
                  `profileUi.emoji${item.id.replace(/(^|-)(\w)/g, (_, _separator, letter: string) => letter.toUpperCase())}`
                )
              })}
              aria-pressed={selected.includes(item.id)}
              onClick={() => {
                onSelect(item.id);
                close();
              }}
            >
              <span aria-hidden="true">{item.emoji}</span>
            </button>
          ))}
        </div>
        {!filtered.length && (
          <p className="yk-reaction-empty" role="status">
            {t("profileUi.reactionSearchEmpty")}{" "}
          </p>
        )}
        <p className="yk-reaction-hint">{t("profileUi.reactionRemoveHint")} </p>
      </Modal>
    </>
  );
}
