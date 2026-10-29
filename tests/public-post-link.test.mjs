import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";
const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: 1, target: 9 }
    }).outputText,
    {
      exports,
      URLSearchParams,
      require: name => (name in mocks ? mocks[name] : require(name))
    }
  );
  return exports;
}
const { publicPostHref, publicPostCursor } = load("lib/ui/public-post-link.ts");
const data = load("lib/data/friend-feed.ts", {
  "@/utils/supabase/client": {},
  "@/lib/data/read-request": {}
});
const { createSocialFeedStore } = load("lib/ui/social-feed-store.ts", {
  "@/lib/data/friend-feed": data
});
const target = {
  id: "f6400000-0000-4000-8000-000000000105",
  createdAt: "2026-10-29T00:47:00.123456+00:00",
  text: "Linked public post",
  author: { id: "public-author" }
};
const cursor = publicPostCursor(target.id, target.createdAt);

test("public post links target Everyone and preserve the precise timestamp and fragment", () => {
  const url = new URL(publicPostHref(target), "https://example.test");
  assert.equal(url.pathname, "/social/everyone");
  assert.equal(url.searchParams.get("post"), target.id);
  assert.equal(url.searchParams.get("at"), target.createdAt);
  assert.equal(url.hash, "#public-post-" + target.id);
  assert.equal(cursor.at, target.createdAt);
  assert.equal(cursor.id, "f6400000-0000-4000-8000-000000000106");
});

test("cursor carry preserves UUID order and invalid links never issue a read", () => {
  assert.equal(
    publicPostCursor("00000000-0000-0000-0000-00000000ffff", target.createdAt)
      .id,
    "00000000-0000-0000-0000-000000010000"
  );
  assert.ok(
    publicPostCursor("ffffffff-ffff-ffff-ffff-ffffffffffff", target.createdAt)
  );
  for (const [id, at] of [
    [null, null],
    ["not-a-post", target.createdAt],
    [target.id, "invalid"],
    [target.id, null]
  ])
    assert.equal(publicPostCursor(id, at), null);
});

test("locating an older public post reads one bounded page without moving the pagination cursor", async () => {
  const next = { id: "next", at: "2026-10-29T01:00:00Z" },
    calls = [];
  const recent = { ...target, id: "recent", createdAt: "2026-10-29T02:00:00Z" };
  const store = createSocialFeedStore(
    async before => {
      calls.push(before);
      return before
        ? { items: [target, { ...target, id: "unrelated" }], next: null }
        : { items: [recent], next };
    },
    async posts => posts.map(post => ({ ...post, activity: { likes: 4 } }))
  );
  await store.refresh();
  assert.equal(await store.locate(target.id, cursor), "found");
  assert.equal(calls.length, 2);
  assert.equal(calls[1], cursor);
  assert.deepEqual(
    Array.from(store.getSnapshot().items, post => post.id),
    ["recent", target.id]
  );
  assert.equal(store.getSnapshot().next, next);
  assert.equal(store.getSnapshot().items[1].activity.likes, 4);
  await store.locate(target.id, cursor);
  assert.equal(
    store.getSnapshot().items.filter(post => post.id === target.id).length,
    1
  );
});

test("a post absent from the protected public response is removed from cached and pending items", async () => {
  const store = createSocialFeedStore(async () => ({ items: [], next: null }));
  store.published(target);
  assert.equal(await store.locate(target.id, cursor), "missing");
  assert.equal(store.getSnapshot().items.length, 0);
  assert.equal(store.getSnapshot().pending.length, 0);
});

test("clear, deletion and disposal cancel stale targeted responses", async () => {
  for (const cancel of [
    store => store.clear(),
    store => store.removed(target.id),
    store => store.dispose()
  ]) {
    let resolve;
    const store = createSocialFeedStore(
      () =>
        new Promise(done => {
          resolve = done;
        })
    );
    const pending = store.locate(target.id, cursor);
    cancel(store);
    resolve({ items: [target], next: null });
    assert.equal(await pending, "cancelled");
    assert.equal(store.getSnapshot().items.length, 0);
  }
});

test("blocking during activity hydration cannot restore the post", async () => {
  let finishHydration, markStarted;
  const hydrationStarted = new Promise(resolve => {
    markStarted = resolve;
  });
  const store = createSocialFeedStore(
    async () => ({ items: [target], next: null }),
    () =>
      new Promise(done => {
        finishHydration = done;
        markStarted();
      })
  );
  const pending = store.locate(target.id, cursor);
  await hydrationStarted;
  store.clear();
  finishHydration([target]);
  assert.equal(await pending, "cancelled");
  assert.equal(store.getSnapshot().items.length, 0);
});

test("failed targeted reads have no private-feed fallback", async () => {
  let calls = 0;
  const store = createSocialFeedStore(async () => {
    calls++;
    throw new Error("unavailable");
  });
  assert.equal(await store.locate(target.id, cursor), "failed");
  assert.equal(calls, 1);
  assert.equal(store.getSnapshot().items.length, 0);
});
