"use client";
import { useSyncExternalStore } from "react";
import { i18nEnabled } from "@/i18n/locale";
const subscribeToHydration = () => () => {};
import { gameErrorKey } from "@/i18n/game-messages";
import { useTranslations, useFormatter } from "next-intl";
/* eslint-disable @next/next/no-img-element -- authenticated private media and animated GIFs. */

import Link from "next/link";
import {
  startTransition,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState
} from "react";
import { Avatar, Button } from "@/components/ui";
import { EmojiReactionPicker } from "@/components/emoji-reaction-picker";
import { GifPicker } from "@/components/gif-picker";
import { PlayerModeration } from "@/components/player-moderation";
import { reactionEmoji } from "@/lib/ui/reaction-emojis";
import {
  liveWallInteractions,
  type WallActivity,
  type WallInteractions
} from "@/lib/data/wall-interactions";
import "@/styles/wall-interactions.css";

export function WallPostInteractions({
  postId,
  initialActivity,
  hideUnavailable = false,
  adapter = liveWallInteractions
}: {
  postId: string;
  initialActivity?: WallActivity | null;
  hideUnavailable?: boolean;
  adapter?: WallInteractions;
}) {
  const fmt = useFormatter();
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false
  );
  const t = useTranslations();
  const [activity, setActivity] = useState<WallActivity | null>(
    initialActivity ?? null
  );
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(
    initialActivity === null
      ? "Couldn't load this post's activity. Access may have changed."
      : ""
  );
  const [status, setStatus] = useState("");
  const [retry, setRetry] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [gif, setGif] = useState("");
  const [cleanup, setCleanup] = useState<string[]>([]);
  const [unavailable, setUnavailable] = useState(initialActivity === null);
  const uploaded = useRef<{ file: File; path: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const sequence = useRef(0);
  const replyId = useRef<string | null>(null);
  const fieldId = useId();
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview]
  );
  async function discard(path: string) {
    try {
      if (!adapter.discard) throw new Error("File cleanup is unavailable.");
      await adapter.discard(path);
      setCleanup(current => current.filter(item => item !== path));
    } catch {
      setCleanup(current => [...new Set([...current, path])]);
    }
  }
  function changeAttachment(next: File | null, nextGif = "") {
    if (lock.current) return;
    if (
      next &&
      (!next.size ||
        next.size > 6 * 1024 * 1024 ||
        !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(
          next.type
        ))
    ) {
      setError("JPG, PNG, WebP, or GIF, up to 6 MB.");
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    if (uploaded.current) {
      void discard(uploaded.current.path);
      uploaded.current = null;
    }
    replyId.current = null;
    setError("");
    setFile(next);
    setPreview(next ? URL.createObjectURL(next) : "");
    setGif(nextGif);
    if (fileInput.current) fileInput.current.value = "";
  }
  const cancel = useCallback(() => {
    sequence.current++;
  }, []);
  useEffect(() => {
    const version = ++sequence.current;
    if (initialActivity !== undefined && retry === 0) return cancel;
    void adapter.read(postId).then(
      value => {
        if (version === sequence.current) {
          setActivity(value);
          setUnavailable(false);
          setError("");
        }
      },
      (reason: { code?: string }) => {
        if (version === sequence.current) {
          setActivity(null);
          const hidden =
            hideUnavailable && reason?.code === "WALL_POST_UNAVAILABLE";
          setUnavailable(hidden);
          setError(
            hidden
              ? ""
              : "Couldn't load this post's activity. Please try again."
          );
        }
      }
    );
    return cancel;
  }, [adapter, postId, retry, cancel, initialActivity, hideUnavailable]);

  async function update(
    kind: "like" | "reply" | "more" | "remove" | "react",
    id?: string
  ) {
    if (lock.current || !activity) return;
    if (kind === "reply" && !text.trim() && !file && !gif) return;
    lock.current = true;
    const version = ++sequence.current;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      let next: WallActivity;
      if (kind === "like")
        next = await adapter.like(postId, !activity.likedByMe);
      else if (kind === "react") {
        const current = activity.reactions?.find(item => item.emoji === id);
        next = await adapter.react(postId, id!, !current?.reactedByMe);
      } else if (kind === "reply") {
        replyId.current ??= crypto.randomUUID();
        if (file && uploaded.current?.file !== file) {
          if (!adapter.upload)
            throw new Error("Image uploads are unavailable. Please try again.");
          uploaded.current = { file, path: await adapter.upload(file) };
        }
        next = await adapter.reply(postId, replyId.current, text.trim(), {
          mediaPath: uploaded.current?.path ?? null,
          gifUrl: gif || null
        });
      } else if (kind === "remove") next = await adapter.remove(postId, id!);
      else next = await adapter.read(postId, activity.next);
      if (version !== sequence.current) return;
      setActivity(
        kind === "more"
          ? {
              ...next,
              items: [
                ...new Map(
                  [...activity.items, ...next.items].map(item => [
                    item.id,
                    item
                  ])
                ).values()
              ]
            }
          : next
      );
      if (kind === "reply") {
        setText("");
        uploaded.current = null;
        setFile(null);
        setPreview("");
        setGif("");
        replyId.current = null;
        setStatus("Reply published");
      }
      if (kind === "remove") {
        setStatus("Reply deleted");
        const path =
          next.deletedMediaPath ??
          activity.items.find(item => item.id === id && item.isMe)?.mediaPath;
        if (path) startTransition(() => discard(path));
      }
    } catch (reason) {
      if (version === sequence.current) {
        setActivity(null);
        setError(
          reason instanceof Error
            ? reason.message
            : "Couldn't update this post. Your draft has been kept."
        );
      }
    } finally {
      lock.current = false;
      if (version === sequence.current) setBusy(false);
    }
  }
  if (hideUnavailable && !activity && (!error || unavailable)) return null;
  return (
    <div className="yk-wall-interactions" data-post-activity={postId}>
      <div className="yk-post-actions">
        <button
          type="button"
          className="yk-post-like"
          aria-pressed={activity?.likedByMe ?? false}
          disabled={busy || !activity}
          onClick={() => void update("like")}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill={activity?.likedByMe ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
          </svg>
          <span>
            {activity?.likedByMe ? t("profileUi.liked") : t("profileUi.like")}
          </span>
          {activity && (
            <strong className="yk-action-count">
              {fmt.number(activity.likes)}
            </strong>
          )}
        </button>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${fieldId}-thread`}
          disabled={!activity}
          onClick={() => setOpen(value => !value)}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-3 3V11.5a8.5 8.5 0 0 1 8.5-8.5h3a8.5 8.5 0 0 1 8.5 8.5Z" />
          </svg>
          <span>{t("profileUi.reply")}</span>
          {activity && (
            <strong className="yk-action-count">
              {fmt.number(activity.replyCount)}
            </strong>
          )}
        </button>
        <EmojiReactionPicker
          disabled={busy || !activity}
          selected={
            activity?.reactions
              ?.filter(item => item.reactedByMe)
              .map(item => item.emoji) ?? []
          }
          onSelect={emoji => void update("react", emoji)}
        />
      </div>
      {!!activity?.reactions?.length && (
        <div
          className="yk-reaction-chips"
          aria-label={t("profileUi.postReactions")}
        >
          {activity.reactions.map(item => {
            const choice = reactionEmoji(item.emoji);
            if (!choice) return null;
            return (
              <button
                key={item.emoji}
                type="button"
                aria-label={t("profileUi.reactionCount", {
                  label: t(
                    `profileUi.emoji${choice.id.replace(/(^|-)(\w)/g, (_, _separator, letter: string) => letter.toUpperCase())}`
                  ),
                  count: item.count
                })}
                aria-pressed={item.reactedByMe}
                disabled={busy}
                title={
                  item.reactedByMe
                    ? t("profileUi.removeReaction", {
                        label: t(
                          `profileUi.emoji${choice.id.replace(/(^|-)(\w)/g, (_, _separator, letter: string) => letter.toUpperCase())}`
                        )
                      })
                    : t("profileUi.reactWith", {
                        label: t(
                          `profileUi.emoji${choice.id.replace(/(^|-)(\w)/g, (_, _separator, letter: string) => letter.toUpperCase())}`
                        )
                      })
                }
                onClick={() => void update("react", item.emoji)}
              >
                <span aria-hidden="true">{choice.emoji}</span>
                <strong>{fmt.number(item.count)}</strong>
              </button>
            );
          })}
        </div>
      )}
      {error && (
        <div role="alert" className="yk-post-error">
          <p>{t(gameErrorKey(error, "profileUi.profileUnavailable"))}</p>
          <Button
            variant="secondary"
            onClick={() => {
              setBusy(false);
              setRetry(value => value + 1);
            }}
          >
            {t("profileUi.retry")}{" "}
          </Button>
        </div>
      )}
      {status && (
        <p role="status" className="yk-post-status">
          {status
            ? t(gameErrorKey(status, "profileUi.profileUnavailable"))
            : ""}
        </p>
      )}
      {!!cleanup.length && (
        <div className="yk-post-error" role="alert">
          <p>{t("profileUi.attachmentCleanupFailed")} </p>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              for (const path of cleanup) startTransition(() => discard(path));
            }}
          >
            {t("profileUi.retryFileCleanup")}{" "}
          </Button>
        </div>
      )}
      {open && (
        <div id={`${fieldId}-thread`} className="yk-post-thread">
          <div className="yk-thread-heading">
            <strong>{t("profileUi.conversation")}</strong>
            <span>
              {t("profileUi.replyCount", { count: activity?.replyCount ?? 0 })}
            </span>
          </div>
          <form
            onSubmit={event => {
              event.preventDefault();
              void update("reply");
            }}
          >
            <label htmlFor={fieldId}>{t("profileUi.yourReply")}</label>
            {activity?.publicReplyNotice && (
              <p className="yk-post-status">
                {t("profileUi.replyVisibilityHint")}{" "}
              </p>
            )}
            <textarea
              id={fieldId}
              className="auth-input"
              placeholder={t("profileUi.writeAReply")}
              maxLength={1000}
              value={text}
              disabled={busy}
              onChange={event => {
                setText(event.target.value);
                replyId.current = null;
              }}
            />
            {(preview || gif) && (
              <figure className="yk-reply-attachment">
                <img
                  src={preview || gif}
                  alt={t("profileUi.replyAttachmentPreview")}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => changeAttachment(null)}
                >
                  {t("profileUi.removeAttachment")}{" "}
                </button>
              </figure>
            )}
            <div className="yk-reply-media-actions">
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                {t("profileUi.addImage")}{" "}
              </Button>
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                aria-label={t("profileUi.replyImage")}
                hidden
                disabled={busy}
                onChange={event => {
                  const next = event.target.files?.[0];
                  if (next) changeAttachment(next);
                }}
              />
              <GifPicker
                disabled={busy}
                onSelect={choice => changeAttachment(null, choice.url)}
              />
            </div>
            <p className="yk-post-status">
              {t("profileUi.oneImageOrGIFPerReplyUpTo")}{" "}
            </p>
            <div className="yk-reply-submit">
              <span>{text.length}/1000</span>
              <Button
                type="submit"
                disabled={busy || !activity || (!text.trim() && !file && !gif)}
              >
                {busy
                  ? t("collectionShared.sending")
                  : t("profileUi.sendReply")}
              </Button>
            </div>
          </form>
          {activity?.items.map(reply => (
            <article
              key={reply.id}
              data-wall-reply={reply.id}
              className="yk-post-reply"
            >
              <Avatar
                name={reply.author.name}
                image={reply.author.avatarUrl ?? undefined}
                size={32}
              />
              <div>
                <header>
                  <Link
                    href={`/profile/${encodeURIComponent(reply.author.id)}?tab=wall`}
                  >
                    {reply.author.name}
                  </Link>
                  <time dateTime={reply.createdAt}>
                    {i18nEnabled() && !hydrated
                      ? "…"
                      : i18nEnabled()
                        ? fmt.dateTime(new Date(reply.createdAt), {
                            ...{
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit"
                            },
                            timeZone:
                              Intl.DateTimeFormat().resolvedOptions().timeZone
                          })
                        : new Date(reply.createdAt).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit"
                          })}
                  </time>
                  {!reply.isMe && (
                    <PlayerModeration
                      userId={reply.author.id}
                      pseudo={reply.author.name}
                      contextType="wall_reply"
                      contextId={reply.id}
                    />
                  )}
                </header>
                {reply.text && <p>{reply.text}</p>}
                {(reply.hasMedia || reply.gifUrl) && (
                  <img
                    className="yk-reply-media"
                    loading="lazy"
                    src={
                      reply.hasMedia
                        ? (reply.previewUrl ??
                          `/api/profile-wall/reply-media/${encodeURIComponent(reply.id)}`)
                        : reply.gifUrl!
                    }
                    alt={
                      reply.hasMedia
                        ? t("profileUi.imageAttachedToReply")
                        : t("profileUi.gifattachedToReply")
                    }
                  />
                )}
                {(reply.isMe || reply.canDelete) && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void update("remove", reply.id)}
                  >
                    {t("profileUi.deleteReply")}{" "}
                  </button>
                )}
              </div>
            </article>
          ))}
          {activity && !activity.items.length && (
            <p className="yk-post-status">{t("profileUi.repliesEmptyHint")} </p>
          )}
          {activity?.next && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void update("more")}
            >
              {t("profileUi.olderReplies")}{" "}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
