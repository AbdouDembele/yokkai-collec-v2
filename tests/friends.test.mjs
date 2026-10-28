import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { readRpcPages } from "../lib/data/rpc-pages.mjs";

function setup(handler, { nodeEnv = "development", paged = false } = {}) {
  const logs = [];
  const calls = [];
  const client = {
    auth: {
      async getSession() {
        return { data: { session: { user: { id: "viewer" } } } };
      }
    },
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "get_friendships_page" && !paged)
        return { data: null, error: { code: "PGRST202", message: "missing" } };
      return handler(name, args);
    }
  };
  const context = {
    exports: {},
    process: { env: { NODE_ENV: nodeEnv } },
    console: { error: (...args) => logs.push(args) },
    require: name => {
      if (name === "@/lib/data/rpc-pages.mjs") return { readRpcPages };
      assert.equal(name, "@/utils/supabase/client");
      return { createClient: () => client };
    }
  };
  const source = ts.transpileModule(
    readFileSync(new URL("../lib/data/friends.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020
      }
    }
  ).outputText;
  vm.runInNewContext(source, context);
  return { api: context.exports, logs, calls };
}

test("friendships load every page without changing the three ordered lists", async () => {
  const items = Array.from({ length: 251 }, (_, i) => ({
    bucket: ["friends", "incoming", "outgoing"][i % 3],
    friend: { id: `friend-${i}`, pseudo: `Name ${i}` }
  }));
  const { api, calls } = setup(
    async (name, args) => {
      if (name === "get_friendships")
        return {
          data: { friends: [], incoming: [], outgoing: [] },
          error: null
        };
      assert.equal(name, "get_friendships_page");
      const offset = Number(args.p_cursor?.id ?? 0);
      return {
        data: {
          items: items.slice(offset, offset + 100),
          nextCursor:
            offset + 100 < items.length ? { id: String(offset + 100) } : null
        },
        error: null
      };
    },
    { paged: true }
  );
  const result = await api.getFriendships();
  for (const bucket of ["friends", "incoming", "outgoing"]) {
    assert.deepEqual(
      Array.from(result[bucket], item => item.id),
      items.filter(item => item.bucket === bucket).map(item => item.friend.id)
    );
  }
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.name === "get_friendships_page"));
});

test("friends pagination never falls back on authorization failure", async () => {
  const { api, calls } = setup(
    async () => ({
      data: null,
      error: { code: "42501", message: "permission denied" }
    }),
    { paged: true }
  );
  await assert.rejects(api.getFriendships(), /permission to do this/i);
  assert.deepEqual(
    calls.map(call => call.name),
    ["get_friendships_page"]
  );
});

test("amis : erreurs métier, autorisation et réseau ont des messages distincts", async () => {
  const business = setup(async () => ({
    data: null,
    error: { message: "CANNOT_FRIEND_SELF", code: "P0001" }
  }));
  await assert.rejects(
    business.api.sendFriendRequest("alice"),
    /add yourself as a friend/i
  );

  const authorization = setup(async () => ({
    data: null,
    error: { message: "Forbidden", status: 403, code: "42501" }
  }));
  await assert.rejects(
    authorization.api.getFriendships(),
    /permission to do this/i
  );
  assert.equal(authorization.logs[0][1].code, "42501");
  assert.equal(authorization.logs[0][1].status, 403);
  assert.equal(authorization.logs[0][1].message, "Forbidden");

  const network = setup(async () => {
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(
    network.api.searchUsers("ali"),
    /Couldn't reach the server/
  );
  assert.equal(network.logs.length, 1);
});

test("amis : une relation existante distingue ami, demande envoyÃ©e et demande reÃ§ue", async () => {
  for (const [bucket, message] of [
    ["friends", /friends with this player/],
    ["outgoing", /this player a friend request/],
    ["incoming", /sent you a friend request/]
  ]) {
    const lists = { friends: [], incoming: [], outgoing: [] };
    lists[bucket].push({ id: "target", pseudo: "Yuki" });
    const { api, calls } = setup(async name =>
      name === "send_friend_request"
        ? { data: null, error: { message: "FRIENDSHIP_EXISTS", code: "P0001" } }
        : { data: lists, error: null }
    );
    await assert.rejects(api.sendFriendRequest("target"), message);
    assert.deepEqual(
      calls.map(call => call.name),
      ["send_friend_request", "get_friendships_page", "get_friendships"]
    );
  }
});

test("amis : les dÃ©tails techniques ne sont pas journalisÃ©s en production", async () => {
  const { api, logs } = setup(
    async () => ({
      data: null,
      error: { message: "permission denied", code: "42501" }
    }),
    { nodeEnv: "production" }
  );
  await assert.rejects(api.getFriendships(), /permission to do this/i);
  assert.equal(logs.length, 0);
});

test("amis : supprimer un ami appelle la RPC avec le bon utilisateur", async () => {
  const { api, calls } = setup(async () => ({ data: true, error: null }));
  assert.equal(await api.removeFriend("friend-id"), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "remove_friend");
  assert.equal(calls[0].args.p_friend_id, "friend-id");
});

test("présence : un utilisateur connecté envoie son activité", async () => {
  const { api, calls } = setup(async () => ({
    data: "2026-10-08T10:00:00Z",
    error: null
  }));
  assert.equal(await api.touchPresence(), true);
  assert.deepEqual(
    calls.map(call => call.name),
    ["touch_presence"]
  );
});

test("demande impossible : aucun message de blocage n’est révélé", async () => {
  const { api } = setup(async () => ({
    data: null,
    error: { message: "ACTION_UNAVAILABLE", code: "P0001" }
  }));
  await assert.rejects(
    api.sendFriendRequest("target"),
    error =>
      error.message === "Couldn't send this request." &&
      !/block/i.test(error.message)
  );
});

test("request limits use English messages without reading relationship data", async () => {
  for (const [code, message] of [
    [
      "FRIEND_REQUEST_LIMIT",
      "You've sent too many friend requests. Try again later."
    ],
    [
      "FRIEND_REQUEST_COOLDOWN",
      "You can send a new request to this player later."
    ]
  ]) {
    for (const lookupExisting of [true, false]) {
      const { api, calls } = setup(async () => ({
        data: null,
        error: { message: code, code: "P0001" }
      }));
      await assert.rejects(
        api.sendFriendRequest("target", lookupExisting),
        error => error.message === message
      );
      assert.deepEqual(
        calls.map(call => call.name),
        ["send_friend_request"]
      );
    }
  }
});
