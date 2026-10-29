import type { FriendFeedCursor } from "@/lib/data/friend-feed";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function publicPostHref(post: { id: string; createdAt: string }) {
  const query = new URLSearchParams({ post: post.id, at: post.createdAt });
  return `/social/everyone?${query}#public-post-${post.id}`;
}

// The public feed uses an exclusive (timestamp, UUID) cursor. Advance only the
// UUID, preserving the database timestamp's microseconds, so the target is first.
export function publicPostCursor(
  id: string | null,
  at: string | null
): FriendFeedCursor | null {
  if (
    !id ||
    !uuid.test(id) ||
    !at ||
    !/^\d{4}-\d{2}-\d{2}T/.test(at) ||
    !Number.isFinite(Date.parse(at))
  )
    return null;
  const next = BigInt("0x" + id.replaceAll("-", "")) + BigInt(1);
  if (next > (BigInt(1) << BigInt(128)) - BigInt(1))
    return {
      at: new Date(Date.parse(at) + 1).toISOString(),
      id: "00000000-0000-0000-0000-000000000000"
    };
  const hex = next.toString(16).padStart(32, "0");
  return {
    at,
    id: hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5")
  };
}
