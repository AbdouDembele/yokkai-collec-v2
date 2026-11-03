import {
  decorateWallActivity,
  type WallActivity,
  type WallInteractions
} from "@/lib/data/wall-interactions";
type Draft = {
  id: { current: string | null };
  text: string;
  file: File | null;
  uploaded: { current: { file: File; path: string } | null };
  gif: string;
  parentId?: string;
};
// Loaded on interaction, not for every post shown in a profile/feed.
export async function applyWallInteraction(
  adapter: WallInteractions,
  kind: "like" | "reply" | "more" | "remove" | "react",
  post: string,
  activity: WallActivity,
  id?: string,
  draft?: Draft
) {
  if (kind === "like") return adapter.like(post, !activity.likedByMe);
  if (kind === "react")
    return adapter.react(
      post,
      id!,
      !activity.reactions?.find(r => r.emoji === id)?.reactedByMe
    );
  if (kind === "reply" && draft) {
    draft.id.current ??= crypto.randomUUID();
    if (draft.file && draft.uploaded.current?.file !== draft.file) {
      if (!adapter.upload)
        throw new Error("Image uploads are unavailable. Please try again.");
      draft.uploaded.current = {
        file: draft.file,
        path: await adapter.upload(draft.file)
      };
    }
    return adapter.reply(post, draft.id.current, draft.text.trim(), {
      mediaPath: draft.uploaded.current?.path ?? null,
      gifUrl: draft.gif || null,
      parentId: draft.parentId ?? null
    });
  }
  if (kind === "remove") return adapter.remove(post, id!);
  const next = await adapter.read(post, activity.next);
  return decorateWallActivity({
    ...next,
    items: [
      ...new Map(
        [...activity.items, ...next.items].map(r => [r.id, r])
      ).values()
    ],
    threadContext: [
      ...new Map(
        [...(activity.threadContext ?? []), ...(next.threadContext ?? [])].map(
          r => [r.id, r]
        )
      ).values()
    ]
  });
}
