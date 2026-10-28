import { intl, gameMessages } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
function load(file, mocks = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: 1, target: 9, jsx: 4 }
    }).outputText,
    {
      exports,
      Error,
      ...globals,
      require: name => (name in mocks ? mocks[name] : require(name))
    }
  );
  return exports;
}
const data = load("lib/data/friend-feed.ts", {
  "@/utils/supabase/client": {},
  "@/lib/data/read-request": {}
});
const { createSocialFeedStore } = load("lib/ui/social-feed-store.ts", {
  "@/lib/data/friend-feed": data
});
const post = (id, author = "alice") => ({
  id,
  createdAt: `2026-10-25T12:00:0${id}Z`,
  relationship: "none",
  requestId: null,
  author: { id: author, name: author }
});

test("Everyone actions use supplied relationship and request id with no relation lookup", async () => {
  const calls = [];
  let actionProps;
  let invalidations = 0;
  const api = load("components/everyone-friend-action.tsx", {
    "@/components/friends": {
      FriendAction: props => {
        actionProps = props;
        return React.createElement("button", null, props.status);
      }
    },
    "@/lib/data/friends": {
      sendFriendRequest: async (...args) => calls.push(["send", ...args]),
      respondFriendRequest: async (...args) => calls.push(["respond", ...args]),
      cancelFriendRequest: async id => calls.push(["cancel", id])
    },
    "@/lib/data/social-unread": {
      invalidateSocialUnread: () => invalidations++
    }
  });
  const expected = {
    none: "none",
    outgoing_pending: "outgoing",
    incoming_pending: "incoming"
  };
  const changes = [];
  for (const relationship of [
    undefined,
    "self",
    "friends",
    "none",
    "outgoing_pending",
    "incoming_pending"
  ]) {
    actionProps = undefined;
    renderToStaticMarkup(
      React.createElement(api.EveryoneFriendAction, {
        post: {
          ...post("1"),
          relationship,
          requestId: relationship === "incoming_pending" ? "request" : null
        },
        onChanged: state => changes.push(state)
      })
    );
    if (relationship in expected) {
      assert.equal(actionProps.status, expected[relationship]);
      assert.equal(
        actionProps.requestId,
        relationship === "incoming_pending" ? "request" : undefined
      );
    } else assert.equal(actionProps, undefined);
  }
  assert.equal(calls.length, 0, "rendering a page must not look up relations");
  await actionProps.adapter.send("alice");
  await actionProps.adapter.respond(actionProps.requestId, true);
  await actionProps.onCancel();
  assert.deepEqual(calls, [
    ["send", "alice", false],
    ["respond", "request", true],
    ["cancel", "alice"]
  ]);
  for (const state of ["outgoing", "accepted", "none"])
    actionProps.onChanged(state);
  assert.deepEqual(changes, ["outgoing_pending", "friends", "none"]);
  assert.equal(invalidations, 3);
});

test("relationship changes update every author occurrence and discard stale in-flight pages", async () => {
  let finish;
  let page = {
    items: [post("2"), post("1", "bob")],
    next: { id: "1", at: post("1").createdAt }
  };
  const store = createSocialFeedStore(
    async cursor =>
      cursor ? new Promise(resolve => (finish = resolve)) : page,
    async posts => posts.map(p => ({ ...p, activity: null }))
  );
  await store.refresh();
  page = { items: [post("3"), post("2")], next: null };
  await store.refresh();
  const more = store.more();
  store.relationshipChanged("alice", "outgoing_pending");
  assert.equal(store.getSnapshot().items[0].relationship, "outgoing_pending");
  assert.equal(store.getSnapshot().pending[0].relationship, "outgoing_pending");
  finish({ items: [post("0")], next: null });
  await more;
  assert.equal(
    store.getSnapshot().items.some(p => p.id === "0"),
    false
  );
  assert.equal(
    store.getSnapshot().next.id,
    "1",
    "a discarded page must remain retryable"
  );
  assert.equal(store.getSnapshot().loadingMore, false);
  assert.ok(
    store
      .getSnapshot()
      .items.filter(p => p.author.id === "alice")
      .every(p => p.relationship === "outgoing_pending")
  );
  assert.equal(
    store.getSnapshot().items.find(p => p.author.id === "bob").relationship,
    "none"
  );
  for (const state of ["friends", "none", "incoming_pending"]) {
    store.relationshipChanged(
      "alice",
      state,
      state === "incoming_pending" ? "new-request" : null
    );
    assert.ok(
      [...store.getSnapshot().items, ...store.getSnapshot().pending]
        .filter(p => p.author.id === "alice")
        .every(p => p.relationship === state)
    );
  }
  page = {
    items: [
      { ...post("3"), relationship: "friends" },
      { ...post("2"), relationship: "friends" }
    ],
    next: null
  };
  await store.refresh();
  assert.ok(
    [...store.getSnapshot().items, ...store.getSnapshot().pending]
      .filter(p => p.author.id === "alice")
      .every(p => p.relationship === "friends")
  );
});

test("FriendAction accepts/declines using an inline request id and supports sender cancellation", async () => {
  const calls = [];
  const changes = [];
  const mocks = new Proxy(
    {},
    {
      has: () => true,
      get: (_, name) => {
        if (name === "next-intl") return intl;
        if (name === "@/i18n/game-messages") return gameMessages;
        if (name === "react")
          return { ...React, useState: initial => [initial, () => {}] };
        if (name === "react/jsx-runtime") return require(name);
        if (name === "@/components/ui")
          return {
            Button: () => null,
            Modal: () => null,
            StatusPill: () => null
          };
        return {};
      }
    }
  );
  const { FriendAction } = load("components/friends.tsx", mocks);
  const children = node =>
    Array.isArray(node)
      ? node.flatMap(children)
      : node?.props
        ? [node, ...children(node.props.children)]
        : [];
  const label = node =>
    Array.isArray(node)
      ? node.map(label).join("")
      : typeof node === "string"
        ? node
        : node?.props
          ? label(node.props.children)
          : "";
  const adapter = {
    respond: async (...args) => calls.push(args),
    friendships: async () => {
      throw new Error("Unexpected relationship query");
    }
  };
  let tree = FriendAction({
    userId: "alice",
    status: "incoming",
    requestId: "request",
    adapter,
    onChanged: s => changes.push(s)
  });
  await children(tree)
    .find(n => label(n) === "Accept " && n.props.onClick)
    .props.onClick();
  // onClick intentionally dispatches async work without returning it.
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [["request", true]]);
  assert.deepEqual(changes, ["accepted"]);
  await children(tree)
    .filter(n => label(n) === "Decline" && n.props.onClick)
    .at(-1)
    .props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls[1], ["request", false]);
  tree = FriendAction({
    userId: "alice",
    status: "outgoing",
    adapter,
    onCancel: async () => calls.push("cancel"),
    onChanged: s => changes.push(s)
  });
  await children(tree)
    .find(n => label(n) === "Cancel request " && n.props.onClick)
    .props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.at(-1), "cancel");
  assert.equal(changes.at(-1), "none");
});

test("Everyone send failures keep existing English errors without reading friendships", async () => {
  const calls = [];
  const { sendFriendRequest, cancelFriendRequest } = load(
    "lib/data/friends.ts",
    {
      "@/utils/supabase/client": {
        createClient: () => ({
          rpc: async name => {
            calls.push(name);
            return { error: { message: "FRIENDSHIP_EXISTS" } };
          }
        })
      },
      "@/lib/data/rpc-pages.mjs": {}
    },
    { process: { env: { NODE_ENV: "production" } } }
  );
  await assert.rejects(
    sendFriendRequest("alice", false),
    /already friends or have a pending request/
  );
  assert.deepEqual(calls, ["send_friend_request"]);
  await assert.rejects(
    cancelFriendRequest("alice"),
    /already friends or have a pending request/
  );
  assert.deepEqual(calls, ["send_friend_request", "cancel_friend_request"]);
});
