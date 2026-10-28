import {
  appendFeedPage,
  type FeedRelationship,
  type FriendFeedLoader,
  type FriendFeedPage,
  type FriendFeedPost
} from "@/lib/data/friend-feed";

export function createSocialFeedStore(
  load: FriendFeedLoader,
  hydrate?: (posts: FriendFeedPost[]) => Promise<FriendFeedPost[]>
) {
  const merge = (first: FriendFeedPost[], second: FriendFeedPost[]) =>
    appendFeedPage(first, second).sort(
      (a, b) =>
        Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
        (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
    );
  let state = {
    available: undefined as boolean | undefined,
    items: [] as FriendFeedPost[],
    next: null as FriendFeedPage["next"],
    pending: [] as FriendFeedPost[],
    loading: true,
    loadingMore: false,
    loaded: false,
    error: ""
  };
  let generation = 0;
  let reading = false;
  let freshCursor: FriendFeedPage["next"] = null;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<typeof state>) => {
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  };
  async function read(more = false) {
    if (reading || (more && !state.next)) return;
    reading = true;
    const version = generation;
    set({
      error: "",
      ...(more ? { loadingMore: true } : { loading: !state.loaded })
    });
    try {
      const page = await load(more ? state.next : null);
      if (version !== generation) return;
      set({ available: page.available !== false });
      if (page.available === false) {
        set({ items: [], pending: [], next: null, loaded: true });
        return;
      }
      if (hydrate) {
        const known = new Map(
          [...state.items, ...state.pending].map(post => [post.id, post])
        );
        const fresh = appendFeedPage(
          [],
          page.items.filter(post => !known.has(post.id))
        );
        const hydrated = new Map(
          (await hydrate(fresh)).map(post => [post.id, post])
        );
        page.items = page.items.map(post => ({
          ...post,
          activity: (hydrated.get(post.id) ?? known.get(post.id))?.activity
        }));
      }
      if (version !== generation) return;
      const latest = new Map(
        page.items
          .filter(post => post.relationship)
          .map(post => [post.author.id, post])
      );
      const update = (post: FriendFeedPost) => {
        const relation = latest.get(post.author.id);
        return relation
          ? {
              ...post,
              relationship: relation.relationship,
              requestId: relation.requestId
            }
          : post;
      };
      if (latest.size)
        set({
          items: state.items.map(update),
          pending: state.pending.map(update)
        });
      if (more) set({ items: merge(state.items, page.items), next: page.next });
      else if (!state.loaded)
        set({
          items: merge(state.items, page.items),
          next: page.next,
          loaded: true
        });
      else {
        freshCursor = page.next;
        const known = new Set(state.items.map(post => post.id));
        set({
          pending: appendFeedPage(
            [],
            page.items.filter(post => !known.has(post.id))
          )
        });
      }
    } catch (error) {
      if (version === generation)
        set({
          error:
            error instanceof Error
              ? error.message
              : "Couldn't load your feed. Please try again."
        });
    } finally {
      if (version === generation) {
        reading = false;
        set({ loading: false, loadingMore: false });
      }
    }
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh: () => read(),
    more: () => read(true),
    showNew: () =>
      set({
        items: merge(state.pending, state.items),
        next: freshCursor,
        pending: []
      }),
    published: (post: FriendFeedPost) =>
      set({
        items: merge([post], state.items),
        pending: state.pending.filter(item => item.id !== post.id)
      }),
    relationshipChanged: (
      authorId: string,
      relationship: FeedRelationship,
      requestId: string | null = null
    ) => {
      generation++;
      reading = false;
      const update = (post: FriendFeedPost) =>
        post.author.id === authorId
          ? { ...post, relationship, requestId }
          : post;
      set({
        items: state.items.map(update),
        pending: state.pending.map(update),
        loading: false,
        loadingMore: false
      });
    },
    removed: (id: string) => {
      generation++;
      reading = false;
      set({
        items: state.items.filter(post => post.id !== id),
        pending: state.pending.filter(post => post.id !== id),
        loading: false,
        loadingMore: false
      });
    },
    clear: () => {
      generation++;
      reading = false;
      set({
        items: [],
        pending: [],
        next: null,
        loaded: false,
        loading: true,
        loadingMore: false,
        error: ""
      });
    },
    dispose: () => {
      generation++;
      reading = false;
    }
  };
}
