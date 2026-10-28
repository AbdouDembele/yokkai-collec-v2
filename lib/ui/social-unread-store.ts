import type {
  SocialUnread,
  SocialUnreadAdapter
} from "@/lib/data/social-unread";
import { startVisiblePolling } from "@/lib/ui/visible-polling";

// One shared feed for the navigation and friend rows; no duplicate polling or
// realtime subscriptions. Generation guards prevent late account/read results.
export function createSocialUnreadStore(adapter: SocialUnreadAdapter) {
  let value: SocialUnread | undefined;
  let generation = 0;
  let running = false;
  let again = false;
  let cleanup: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(listener => listener());
  const reset = () => {
    generation++;
    value = undefined;
    emit();
  };
  const refresh = async () => {
    if (!listeners.size || document.hidden) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    const version = generation;
    try {
      const fresh = await adapter.load();
      if (version === generation && listeners.size) {
        value = fresh;
        emit();
      }
    } catch {
      /* Keep the last confirmed count; retry on the next visible poll. */
    } finally {
      running = false;
      if (again) {
        again = false;
        void refresh();
      }
    }
  };
  const invalidate = () => {
    generation++;
    void refresh();
  };
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      if (listeners.size === 1) {
        const stopAdapter = adapter.subscribe?.(invalidate, reset);
        const stopPoll = startVisiblePolling(() => void refresh(), 15_000);
        const storage = (event: StorageEvent) => {
          if (event.key === "yokkai:social-unread-invalidation") invalidate();
        };
        const events = [
          "social-unread-changed",
          "private-message-received",
          "player-block-changed",
          "focus",
          "online"
        ];
        events.forEach(event => window.addEventListener(event, invalidate));
        window.addEventListener("storage", storage);
        cleanup = () => {
          stopAdapter?.();
          stopPoll();
          events.forEach(event =>
            window.removeEventListener(event, invalidate)
          );
          window.removeEventListener("storage", storage);
        };
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          cleanup?.();
          cleanup = undefined;
          reset();
        }
      };
    }
  };
}
