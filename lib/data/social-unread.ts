import { createClient } from "@/utils/supabase/client";
import { readRequest } from "@/lib/data/read-request";
import { subscribeNotifications } from "@/lib/data/notifications";

export type SocialUnread = {
  viewerId: string;
  messages: { friendId: string; count: number }[];
  messageCount: number;
  requestCount: number;
};
export type SocialUnreadAdapter = {
  load: () => Promise<SocialUnread>;
  // Reset counts immediately on identity changes, including sign-out.
  subscribe?: (refresh: () => void, reset: () => void) => () => void;
};
export function invalidateSocialUnread() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("social-unread-changed"));
  // Invalidation only: never persist counts, message contents or player IDs.
  try {
    localStorage.setItem("yokkai:social-unread-invalidation", crypto.randomUUID());
  } catch { /* Storage may be disabled. Visible polling still synchronizes. */ }
}
export const liveSocialUnread: SocialUnreadAdapter = {
  load: async () => {
    const { data, error } = await readRequest(signal =>
      createClient().rpc("get_social_unread").abortSignal(signal)
    );
    if (error) throw new Error("Couldn't load unread activity.");
    return data as SocialUnread;
  },
  subscribe: (refresh, reset) => {
    let active = true;
    let stopRealtime = () => {};
    let identity: string | null | undefined;
    const { data } = createClient().auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (active && next !== identity) {
        identity = next;
        stopRealtime();
        stopRealtime = () => {};
        reset();
        // Do not await another Supabase operation inside the auth callback.
        queueMicrotask(() => {
          if (!active || identity !== next) return;
          if (next) stopRealtime = subscribeNotifications(refresh);
          refresh();
        });
      }
    });
    return () => { active = false; data.subscription.unsubscribe(); stopRealtime(); };
  }
};
