import {
  decorateWallActivity,
  type WallActivity,
  type WallInteractions
} from "@/lib/data/wall-interactions";
import type { WallAdapter } from "@/lib/data/profile-wall";
// Notification-only navigation: keep cursor scans out of normal profile loads.
export async function loadReplyTarget(
  adapter: WallInteractions,
  postId: string,
  target: string,
  active: () => boolean
): Promise<WallActivity> {
  let page = await adapter.read(postId);
  const items = [...page.items],
    context = [...(page.threadContext ?? [])];
  for (
    let n = 1;
    active() &&
    ![...items, ...context].some(r => r.id === target) &&
    page.next &&
    n < 50;
    n++
  ) {
    page = await adapter.read(postId, page.next);
    items.push(...page.items);
    context.push(...(page.threadContext ?? []));
  }
  return decorateWallActivity({
    ...page,
    items: [...new Map(items.map(r => [r.id, r])).values()],
    threadContext: [...new Map(context.map(r => [r.id, r])).values()]
  });
}
export async function loadPostTarget(
  adapter: WallAdapter,
  ownerId: string,
  active: () => boolean
) {
  const target =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("post");
  let page = await adapter.list(ownerId);
  const items = [...page.items];
  for (
    let n = 1;
    active() &&
    target &&
    !items.some(p => p.id === target) &&
    page.next &&
    n < 25;
    n++
  ) {
    page = await adapter.list(ownerId, page.next);
    items.push(...page.items);
  }
  return { ...page, items };
}
// The notification path is loaded only when a post/reply target is present.
export function watchReplyNotification(
  adapter: WallInteractions,
  postId: string,
  target: string,
  active: () => boolean,
  loaded: (page: WallActivity) => void,
  failed: () => void
) {
  let stopped = false,
    frame = 0;
  const current = () => !stopped && active();
  const observer = new MutationObserver(() => schedule());
  const focus = () => {
    if (!current()) return;
    const node = document.getElementById(`wall-reply-${target}`);
    if (node && node.getClientRects().length) {
      node.scrollIntoView({ block: "center" });
      node.focus({ preventScroll: true });
      observer.disconnect();
    }
  };
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(focus);
  };
  void loadReplyTarget(adapter, postId, target, current).then(
    page => {
      if (!current()) return;
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["open"]
      });
      loaded(page);
      schedule();
    },
    () => {
      if (current()) failed();
    }
  );
  return () => {
    stopped = true;
    observer.disconnect();
    cancelAnimationFrame(frame);
  };
}
