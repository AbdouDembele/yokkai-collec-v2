"use client";
import { useMemo, useRef } from "react";
import { WallPostInteractions } from "@/components/wall-post-interactions";
import { notificationItem } from "@/lib/notification-item";
import { useTranslations } from "next-intl";
import type {
  WallActivity,
  WallInteractions
} from "@/lib/data/wall-interactions";
const author = (id: string, name: string) => ({ id, name, avatarUrl: null });
export function ThreadedRepliesPreview({
  compact = false
}: {
  compact?: boolean;
}) {
  const t = useTranslations("topbar");
  const initial = useMemo<WallActivity>(
    () => ({
      likes: 1,
      likedByMe: false,
      replyCount: 4,
      next: null,
      items: [
        {
          id: "reply-child",
          parentId: "reply-parent",
          text: "A reply below the comment, with its own author.",
          author: author("bob", "Mochi"),
          isMe: false,
          createdAt: "2026-11-03T08:30:00Z"
        },
        {
          id: "reply-deep",
          parentId: "reply-child",
          text: "The conversation continues without shrinking the text on a phone.",
          author: author("viewer", "Yuna"),
          isMe: true,
          createdAt: "2026-11-03T08:35:00Z"
        },
        {
          id: "reply-other",
          text: "Another conversation.",
          author: author("other", "Akuma"),
          isMe: false,
          createdAt: "2026-11-03T08:10:00Z"
        },
        {
          id: "reply-parent",
          text: "Anyone collecting these cards? A very long comment with Supercalifragilisticexpialidocious to test wrapping on phones.",
          author: author("alice", "Kitsune"),
          isMe: false,
          createdAt: "2026-11-03T08:00:00Z"
        }
      ]
    }),
    []
  );
  const value = useRef(initial);
  const adapter = useMemo<WallInteractions>(
    () => ({
      read: async () => structuredClone(value.current),
      like: async (_post, liked) => {
        value.current = {
          ...value.current,
          likedByMe: liked,
          likes: liked ? 2 : 1
        };
        return structuredClone(value.current);
      },
      react: async () => structuredClone(value.current),
      reply: async (_post, id, text, attachment) => {
        if (text === "Simulated failure")
          throw new Error("WALL_REPLY_UNAVAILABLE");
        value.current = {
          ...value.current,
          replyCount: value.current.replyCount + 1,
          items: [
            ...value.current.items,
            {
              id,
              text,
              parentId: attachment?.parentId,
              author: author("viewer", "Yuna"),
              isMe: true,
              createdAt: new Date().toISOString(),
              gifUrl: attachment?.gifUrl
            }
          ]
        };
        return structuredClone(value.current);
      },
      remove: async (_post, id) => {
        value.current = {
          ...value.current,
          replyCount: value.current.replyCount - 1,
          items: value.current.items
            .filter(r => r.id !== id)
            .map(r => (r.parentId === id ? { ...r, parentId: null } : r))
        };
        return structuredClone(value.current);
      }
    }),
    []
  );
  const notification = notificationItem(
    {
      id: "fixture-note",
      type: "wall_reply_received",
      referenceId: "reply-child",
      postId: "fixture-post",
      replyId: "reply-child",
      postOwnerId: "fixture-owner",
      actorPseudo: "Mochi",
      readAt: null,
      createdAt: "2026-11-03T08:30:00Z",
      cardName: null,
      achievementName: null
    },
    t
  );
  return (
    <main style={{ maxWidth: 900, margin: "24px auto", padding: 16 }}>
      <h1>Conversation preview</h1>
      <p>In-memory fixtures. No messages or notifications are sent.</p>
      <aside className="yk-profile-notice">
        <strong>{notification.title}</strong>
        <p>{notification.text}</p>
      </aside>
      <WallPostInteractions
        postId="fixture-post"
        compact={compact}
        initialActivity={initial}
        adapter={adapter}
      />
    </main>
  );
}
