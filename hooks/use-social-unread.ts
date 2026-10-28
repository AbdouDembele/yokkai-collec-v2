"use client";
import { useSyncExternalStore } from "react";
import {
  liveSocialUnread,
  type SocialUnreadAdapter
} from "@/lib/data/social-unread";
import { createSocialUnreadStore } from "@/lib/ui/social-unread-store";

const stores = new WeakMap<
  SocialUnreadAdapter,
  ReturnType<typeof createSocialUnreadStore>
>();
const empty = () => undefined;
const noopSubscribe = () => () => {};
export function useSocialUnread(adapter = liveSocialUnread, enabled = true) {
  let store = stores.get(adapter);
  if (!store) {
    store = createSocialUnreadStore(adapter);
    stores.set(adapter, store);
  }
  return useSyncExternalStore(
    enabled ? store.subscribe : noopSubscribe,
    enabled ? store.getSnapshot : empty,
    empty
  );
}
