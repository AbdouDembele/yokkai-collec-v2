"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from "react";
import {
  advanceTypeahead,
  typeaheadMatchIndex,
  type TypeaheadBuffer
} from "@/lib/ui/select-typeahead";

export function RankingChoice<T>({
  id,
  labelId,
  className = "",
  items,
  selected,
  getKey,
  getLabel,
  placeholder,
  loading = false,
  hasMore = false,
  loadingLabel,
  emptyLabel,
  errorLabel,
  onLoadMore,
  onSelect,
  findMatch
}: {
  id: string;
  labelId: string;
  className?: string;
  items: T[];
  selected: T | null;
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  placeholder: string;
  loading?: boolean;
  hasMore?: boolean;
  loadingLabel?: string;
  emptyLabel?: string;
  errorLabel?: string;
  onLoadMore?: () => void;
  onSelect: (item: T) => void;
  findMatch?: (prefix: string, signal: AbortSignal) => Promise<T | null>;
}) {
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<T[]>([]);
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const [pendingPrefix, setPendingPrefix] = useState("");
  const [finding, setFinding] = useState(false);
  const [failed, setFailed] = useState(false);
  const container = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    list = useRef<HTMLDivElement>(null);
  const buffer = useRef<TypeaheadBuffer>({ text: "", updatedAt: 0 });
  const moreRequested = useRef(false);
  const options = useMemo(
    () => [
      ...new Map(
        [...items, ...found].map(item => [getKey(item), item])
      ).values()
    ],
    [items, found, getKey]
  );
  const focusOption = useCallback((key: string) => {
    const option = [
      ...(list.current?.querySelectorAll<HTMLButtonElement>(
        '[role="option"]'
      ) ?? [])
    ].find(node => node.dataset.choiceKey === key);
    option?.focus({ preventScroll: true });
    option?.scrollIntoView({ block: "nearest" });
  }, []);
  const resetTyping = useCallback(() => {
    buffer.current = { text: "", updatedAt: 0 };
    setPendingPrefix("");
    setTargetKey(null);
    setFinding(false);
    setFailed(false);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    resetTyping();
  }, [resetTyping]);
  const requestMore = () => {
    if (!loading && hasMore && !moreRequested.current) {
      moreRequested.current = true;
      onLoadMore?.();
    }
  };
  useEffect(() => {
    moreRequested.current = false;
  }, [items, loading]);
  useEffect(() => {
    if (!open) return;
    const nodes =
      list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
    const current = [...(nodes ?? [])].find(
      node => node.getAttribute("aria-selected") === "true"
    );
    (current ?? nodes?.[0] ?? list.current)?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !container.current?.contains(event.target)
      )
        close();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, close]);
  useEffect(() => {
    if (open && targetKey !== null) focusOption(targetKey);
  }, [open, targetKey, options, focusOption]);
  useEffect(() => {
    if (!open || !pendingPrefix || !findMatch) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void findMatch(pendingPrefix, controller.signal)
        .then(item => {
          if (
            controller.signal.aborted ||
            buffer.current.text !== pendingPrefix
          )
            return;
          setFinding(false);
          setPendingPrefix("");
          if (item !== null) {
            setFound(current => [
              ...current.filter(value => getKey(value) !== getKey(item)),
              item
            ]);
            setTargetKey(getKey(item));
          }
        })
        .catch(() => {
          if (
            !controller.signal.aborted &&
            buffer.current.text === pendingPrefix
          ) {
            setFinding(false);
            setPendingPrefix("");
            setFailed(true);
          }
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, pendingPrefix, findMatch, getKey]);
  const typeLetter = (key: string) => {
    buffer.current = advanceTypeahead(buffer.current, key, Date.now());
    if (!buffer.current.text) return;
    const current = options.findIndex(
      item =>
        getKey(item) === document.activeElement?.getAttribute("data-choice-key")
    );
    const match = typeaheadMatchIndex(
      options.map(getLabel),
      buffer.current.text,
      current
    );
    setFailed(false);
    if (match >= 0) {
      setPendingPrefix("");
      setFinding(false);
      setTargetKey(getKey(options[match]));
      focusOption(getKey(options[match]));
    } else if (findMatch) {
      setPendingPrefix(buffer.current.text);
      setFinding(true);
    }
  };
  const printable = (event: KeyboardEvent) =>
    !event.nativeEvent.isComposing &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    event.key.length === 1 &&
    (event.key !== " " || buffer.current.text.length > 0);
  return (
    <div className={`yk-ranking-choice ${className}`} ref={container}>
      <button
        id={id}
        type="button"
        ref={trigger}
        aria-labelledby={`${labelId} ${id}-value`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-options` : undefined}
        disabled={!items.length && selected === null}
        onClick={() => {
          if (open) close();
          else setOpen(true);
        }}
        onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          } else if (printable(event)) {
            event.preventDefault();
            setOpen(true);
            typeLetter(event.key);
          }
        }}
      >
        <span id={`${id}-value`}>
          {selected !== null ? getLabel(selected) : placeholder}
        </span>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div
          id={`${id}-options`}
          ref={list}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={labelId}
          aria-busy={loading || finding}
          onScroll={event => {
            const node = event.currentTarget;
            if (node.scrollHeight - node.scrollTop - node.clientHeight < 80)
              requestMore();
          }}
          onKeyDown={event => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
              trigger.current?.focus();
              return;
            }
            if (event.key === "Tab") {
              close();
              return;
            }
            if (printable(event)) {
              event.preventDefault();
              typeLetter(event.key);
              return;
            }
            const nodes = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="option"]'
              )
            ];
            const current = nodes.findIndex(
              node => node === document.activeElement
            );
            let next = current;
            if (event.key === "ArrowDown") {
              next = Math.min(nodes.length - 1, current + 1);
              if (current === nodes.length - 1) requestMore();
            } else if (event.key === "ArrowUp") next = Math.max(0, current - 1);
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") {
              next = nodes.length - 1;
              requestMore();
            } else return;
            event.preventDefault();
            resetTyping();
            nodes[next]?.focus();
          }}
        >
          {options.map(item => (
            <button
              key={getKey(item)}
              type="button"
              role="option"
              tabIndex={-1}
              data-choice-key={getKey(item)}
              aria-selected={
                selected !== null && getKey(item) === getKey(selected)
              }
              onClick={() => {
                onSelect(item);
                close();
                trigger.current?.focus();
              }}
            >
              {getLabel(item)}
            </button>
          ))}
          {(loading || finding) && loadingLabel && (
            <p role="status">{loadingLabel}</p>
          )}
          {failed && <p role="alert">{errorLabel}</p>}
          {!options.length && !loading && !finding && <p>{emptyLabel}</p>}
        </div>
      )}
    </div>
  );
}
