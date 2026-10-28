"use client";

import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { HomeFriendFeed } from "@/components/home-friend-feed";
import { Button } from "@/components/ui";
import type { FriendFeedLoader, FriendFeedPost } from "@/lib/data/friend-feed";
import { AUTH_MARQUEE_CARDS } from "@/lib/auth/showcase-cards";
import type { WallAdapter } from "@/lib/data/profile-wall";
import type {
  WallActivity,
  WallInteractions
} from "@/lib/data/wall-interactions";

const posts: FriendFeedPost[] = [
  {
    id: "sample-1",
    text:
      "Finally completed my Jujutsu Kaisen binder! That last card was worth the wait. ✨ " +
      "Thanks to everyone who helped with trades along the way. I still have a few duplicates to share, " +
      "and I am already planning my next binder. Visit my wall to see the full update and tell me what you are collecting next.",
    hasMedia: false,
    gifUrl: null,
    createdAt: "2026-10-20T18:45:00Z",
    author: {
      id: "preview-kitsune",
      name: "Kitsune",
      avatarUrl: AUTH_MARQUEE_CARDS[0].image
    }
  },
  {
    id: "sample-2",
    text: "Today's Decision Pack really made me choose… Gojo or NEWJEANS?",
    hasMedia: false,
    gifUrl:
      "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/3o7aD2saalBwwftBIY/giphy.gif",
    createdAt: "2026-10-20T18:30:00Z",
    author: {
      id: "preview-moonflower",
      name: "Moonflower",
      avatarUrl: AUTH_MARQUEE_CARDS[1].image
    }
  },
  {
    id: "sample-3",
    text: "Looking for a spare Bart Simpson for my collection. See you in trades!",
    hasMedia: false,
    gifUrl: null,
    createdAt: "2026-10-20T18:15:00Z",
    author: { id: "preview-raven", name: "Raven", avatarUrl: null }
  },
  {
    id: "sample-4",
    text: "A new favorite for the collection. What did you pull today?",
    hasMedia: false,
    gifUrl: null,
    createdAt: "2026-10-20T18:00:00Z",
    author: {
      id: "preview-kitsune",
      name: "Kitsune",
      avatarUrl: AUTH_MARQUEE_CARDS[0].image
    }
  }
];

export function HomeFriendFeedPreview() {
  const t = useTranslations("homeDashboard");
  const [empty, setEmpty] = useState(false);
  const [fail, setFail] = useState(false);
  const [failPublish, setFailPublish] = useState(false);
  const [published, setPublished] = useState("");
  const [publishCount, setPublishCount] = useState(0);
  const ownPosts = useRef<FriendFeedPost[]>([]);
  const [failInteractions, setFailInteractions] = useState(false);
  const interactions = useMemo<WallInteractions>(() => {
    const state = new Map<string, WallActivity>();
    const read = async (post: string) => {
      if (failInteractions)
        throw new Error(
          "Preview interaction failure. Your draft has been kept."
        );
      if (!state.has(post))
        state.set(post, {
          likes: 3,
          reactions: [
            { emoji: "fire", count: 2, reactedByMe: false },
            { emoji: "heart", count: 1, reactedByMe: false }
          ],
          likedByMe: false,
          replyCount: 1,
          items: [
            {
              id: `reply-${post}`,
              text: "Great pull! That card is on my wishlist too.",
              createdAt: "2026-10-20T19:00:00Z",
              isMe: false,
              author: posts[1].author
            }
          ],
          next: null
        });
      return structuredClone(state.get(post)!);
    };
    return {
      read,
      react: async (post, emoji, reacted) => {
        const value = await read(post);
        value.reactions ??= [
          { emoji: "fire", count: 2, reactedByMe: false },
          { emoji: "heart", count: 1, reactedByMe: false }
        ];
        const current = value.reactions.find(item => item.emoji === emoji);
        if (current) {
          current.count += Number(reacted) - Number(current.reactedByMe);
          current.reactedByMe = reacted;
        } else if (reacted)
          value.reactions.push({ emoji, count: 1, reactedByMe: true });
        value.reactions = value.reactions.filter(item => item.count > 0);
        state.set(post, value);
        return value;
      },
      like: async (post, liked) => {
        const value = await read(post);
        value.likes += Number(liked) - Number(value.likedByMe);
        value.likedByMe = liked;
        state.set(post, value);
        return value;
      },
      upload: async file => URL.createObjectURL(file),
      discard: async path => {
        if (path.startsWith("blob:")) URL.revokeObjectURL(path);
      },
      reply: async (post, id, text, attachment) => {
        const value = await read(post);
        if (!value.items.some(item => item.id === id)) {
          value.items.unshift({
            id,
            text,
            hasMedia: !!attachment?.mediaPath,
            previewUrl: attachment?.mediaPath ?? undefined,
            gifUrl: attachment?.gifUrl ?? null,
            createdAt: new Date().toISOString(),
            isMe: true,
            author: posts[2].author
          });
          value.replyCount++;
        }
        state.set(post, value);
        return value;
      },
      remove: async (post, id) => {
        const value = await read(post);
        value.items = value.items.filter(item => item.id !== id || !item.isMe);
        value.replyCount = value.items.length;
        state.set(post, value);
        return value;
      }
    };
  }, [failInteractions]);
  const wallAdapter = useMemo<WallAdapter>(
    () => ({
      list: async () => {
        throw new Error("Composer must not fetch the wall");
      },
      publish: async input => {
        await new Promise(resolve => setTimeout(resolve, 200));
        if (failPublish)
          throw new Error(
            "Couldn't publish your post. Your draft has been kept."
          );
        const post = { ...input, createdAt: new Date().toISOString() };
        if (!ownPosts.current.some(item => item.id === post.id)) {
          ownPosts.current.unshift({
            id: post.id,
            text: post.text,
            hasMedia: false,
            gifUrl: post.gifUrl,
            createdAt: post.createdAt,
            author: posts[2].author
          });
          setPublished(input.text || "Media post");
          setPublishCount(count => count + 1);
        }
        return post;
      },
      upload: async (_file, ownerId) => `${ownerId}/preview.png`,
      remove: async id => {
        if (failPublish)
          throw new Error("Couldn't delete this post. Please try again.");
        ownPosts.current = ownPosts.current.filter(post => post.id !== id);
        return null;
      },
      discard: async () => {}
    }),
    [failPublish]
  );
  const initial = useMemo(
    () => ({
      items: empty ? [] : posts.slice(0, 3),
      next: empty ? null : { at: posts[2].createdAt, id: posts[2].id }
    }),
    [empty]
  );
  const load = useMemo<FriendFeedLoader>(
    () => async cursor => {
      await new Promise(resolve => setTimeout(resolve, 200));
      if (fail) throw new Error("Preview failure");
      return {
        items: empty
          ? []
          : cursor
            ? posts.slice(2)
            : [...ownPosts.current, ...posts.slice(0, 3)],
        next: !empty && !cursor ? initial.next : null
      };
    },
    [fail, empty, initial.next]
  );
  return (
    <div style={{ gridColumn: "1 / -1", minWidth: 0 }}>
      <div
        style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}
      >
        <Button variant="secondary" onClick={() => setEmpty(value => !value)}>
          {empty ? t("previewSamplePosts") : t("previewEmptyFeed")}
        </Button>
        <label>
          <input
            type="checkbox"
            checked={fail}
            onChange={event => setFail(event.target.checked)}
          />{" "}
          {t("previewFailFeed")}
        </label>
        <label>
          <input
            type="checkbox"
            checked={failPublish}
            onChange={event => setFailPublish(event.target.checked)}
          />{" "}
          {t("previewFailPublishing")}
        </label>
        <p>{t("previewLocalOnly")}</p>
        <label>
          <input
            type="checkbox"
            checked={failInteractions}
            onChange={event => setFailInteractions(event.target.checked)}
          />{" "}
          {t("previewFailInteractions")}
        </label>
        {published && (
          <p role="status" data-preview-published={publishCount}>
            {t("previewPublished", { post: published })}
          </p>
        )}
      </div>
      <HomeFriendFeed
        initial={initial}
        load={load}
        viewer={posts[2].author}
        wallAdapter={wallAdapter}
        interactions={interactions}
      />
    </div>
  );
}
