export type PlayerSnapshotScope = "balance" | "collection" | "profile";

export const PLAYER_SNAPSHOT_TTL = {
  balance: 60_000,
  collection: 10_000,
  profile: 0,
} as const;

type CacheEntry = { expires: number; promise: Promise<unknown>; pending?: boolean; invalidated?: boolean };

export function createPlayerSnapshotCache(now: () => number = Date.now) {
  const entries = new Map<string, CacheEntry>();
  return {
    memo<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
      const existing = entries.get(key);
      if (existing && existing.expires > now()) return existing.promise as Promise<T>;
      const entry: CacheEntry = { expires: Infinity, promise: Promise.resolve(), pending: true };
      entry.promise = (async () => {
        let value: T;
        do { entry.invalidated = false; value = await load(); } while (entry.invalidated);
        return value;
      })().then(value => {
        entry.pending = false;
        entry.expires = now() + ttl;
        return value;
      }, error => {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      });
      entries.set(key, entry);
      return entry.promise as Promise<T>;
    },
    delete(key: string) { const entry = entries.get(key); if (entry?.pending) entry.invalidated = true; else entries.delete(key); },
    clear() { entries.clear(); },
    deleteScope(scope: PlayerSnapshotScope) {
      const prefix = scope === "balance" ? "info:" : scope === "collection" ? "collection:" : "profile:";
      for (const key of entries.keys()) if (key.startsWith(prefix)) { const entry = entries.get(key)!; if (entry.pending) entry.invalidated = true; else entries.delete(key); }
    },
  };
}

type Listener = (scopes: readonly PlayerSnapshotScope[]) => void;
const listeners = new Set<Listener>();
const channelName = "yokkai-player-snapshots";
let channel: BroadcastChannel | undefined;

function normalized(scopes: readonly PlayerSnapshotScope[]) {
  return [...new Set(scopes)].sort() as PlayerSnapshotScope[];
}

function notify(scopes: readonly PlayerSnapshotScope[]) {
  const uniqueScopes = normalized(scopes);
  if (!uniqueScopes.length) return;
  for (const listener of listeners) listener(uniqueScopes);
}

function getChannel() {
  if (channel || typeof window === "undefined" || typeof BroadcastChannel === "undefined") return channel;
  channel = new BroadcastChannel(channelName);
  channel.addEventListener("message", event => {
    if (Array.isArray(event.data)) notify(event.data.filter(scope => scope === "balance" || scope === "collection" || scope === "profile"));
  });
  return channel;
}

export function publishPlayerSnapshotInvalidation(scopes: readonly PlayerSnapshotScope[]) {
  const uniqueScopes = normalized(scopes);
  if (!uniqueScopes.length) return;
  notify(uniqueScopes);
  getChannel()?.postMessage(uniqueScopes);
}

export function subscribePlayerSnapshotInvalidation(listener: Listener) {
  listeners.add(listener);
  getChannel();
  return () => { listeners.delete(listener); };
}
