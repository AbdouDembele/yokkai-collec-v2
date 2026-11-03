import type { WallActivity, WallReply } from "@/lib/data/wall-interactions";
// Flatten the tree for bounded indentation on phones, while retaining the exact
// parent relation and chronological order within each conversation.
export function wallReplyThread(activity: WallActivity | null) {
  const all = [
    ...new Map(
      [...(activity?.threadContext ?? []), ...(activity?.items ?? [])].map(
        r => [r.id, r]
      )
    ).values()
  ];
  const byId = new Map(all.map(r => [r.id, r]));
  const result: { reply: WallReply; depth: number; parent?: WallReply }[] = [];
  const seen = new Set<string>();
  const visit = (reply: WallReply, depth: number) => {
    if (seen.has(reply.id)) return;
    seen.add(reply.id);
    result.push({ reply, depth, parent: byId.get(reply.parentId ?? "") });
    all
      .filter(r => r.parentId === reply.id)
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
      )
      .forEach(r => visit(r, depth + 1));
  };
  all
    .filter(r => !r.parentId || !byId.has(r.parentId))
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
    )
    .forEach(r => visit(r, 0));
  all.forEach(r => visit(r, 0));
  return result;
}

export type WallReplyThread = ReturnType<typeof wallReplyThread>;
