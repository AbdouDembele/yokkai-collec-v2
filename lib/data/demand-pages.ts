export type PageCursor = Record<string, unknown> | null;
export type RpcPage<T> = { items: T[]; nextCursor: PageCursor };

// Refresh only the pages the player has requested. Commit atomically so a failed
// later page keeps the visible list and its retry cursor intact.
export function createDemandPager<T>(load: (cursor: PageCursor) => Promise<RpcPage<T>>, key: (item: T) => string) {
  let pageCount = 0;
  let snapshot: RpcPage<T> = { items: [], nextCursor: null };
  let pending: Promise<RpcPage<T>> | undefined;
  let pendingMore=false;
  let queuedMore: Promise<RpcPage<T>> | undefined;
  function read(more: boolean): Promise<RpcPage<T>> {
    if (pending) {
      if (more && !pendingMore) {
        queuedMore ??= pending.then(() => read(true)).finally(() => { queuedMore=undefined; });
        return queuedMore;
      }
      return pending;
    }
    if (more && pageCount && !snapshot.nextCursor) return Promise.resolve(snapshot);
    pendingMore=more;
    pending = (async () => {
      let cursor = more && pageCount ? snapshot.nextCursor : null;
      const items = new Map((more ? snapshot.items : []).map(item => [key(item), item]));
      let count = 0;
      do {
        const page = await load(cursor);
        if (page.nextCursor && JSON.stringify(page.nextCursor) === JSON.stringify(cursor)) throw new Error("Page cursor did not advance.");
        for (const item of page.items) items.set(key(item), item);
        cursor = page.nextCursor;
        count++;
      } while (!more && cursor && count < Math.max(1, pageCount));
      snapshot = { items: [...items.values()], nextCursor: cursor };
      pageCount = more ? pageCount + count : count;
      return snapshot;
    })().finally(() => { pending = undefined; });
    return pending;
  }
  return { refresh: () => read(false), more: () => read(true) };
}
