import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import {
  ALLOWED_GIF_RATINGS,
  verifyGifRating
} from "../lib/server/gif-rating.mjs";

const giphy = (status, data) => async url => {
  assert.match(
    url,
    /^https:\/\/api\.giphy\.com\/v1\/gifs\/[A-Za-z0-9]+\?api_key=/
  );
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => ({ data })
  };
};

test("the server reads GIPHY's rating, records it and answers with the verdict", async () => {
  const recorded = [];
  const record = async (id, rating) => recorded.push([id, rating]);
  const base = { apiKey: "key", record, consume: async () => null };
  assert.deepEqual(
    await verifyGifRating({ ...base, id: "../x", fetchGif: giphy(200, {}) }),
    { status: 400 }
  );
  assert.deepEqual(
    await verifyGifRating({
      ...base,
      id: "abc",
      apiKey: "",
      fetchGif: giphy(200, {})
    }),
    { status: 503 }
  );
  assert.deepEqual(
    await verifyGifRating({
      ...base,
      id: "abc",
      fetchGif: giphy(200, { id: "abc", rating: "pg-13" })
    }),
    { status: 200, allowed: true }
  );
  assert.deepEqual(
    await verifyGifRating({
      ...base,
      id: "hot",
      fetchGif: giphy(200, { id: "hot", rating: "R" })
    }),
    { status: 200, allowed: false }
  );
  assert.deepEqual(recorded, [
    ["abc", "pg-13"],
    ["hot", "r"]
  ]);
  assert.deepEqual(
    await verifyGifRating({ ...base, id: "gone", fetchGif: giphy(404) }),
    { status: 200, allowed: false }
  );
  for (const fetchGif of [
    giphy(200, { id: "other", rating: "g" }),
    giphy(200, { id: "abc" }),
    giphy(500),
    async () => {
      throw new Error("offline");
    }
  ])
    assert.deepEqual(await verifyGifRating({ ...base, id: "abc", fetchGif }), {
      status: 502
    });
  // Before the migration the RPC is missing: the verdict still reaches the client.
  assert.deepEqual(
    await verifyGifRating({
      apiKey: "key",
      consume: async () => null,
      id: "abc",
      fetchGif: giphy(200, { id: "abc", rating: "g" }),
      record: async () => {
        throw new Error("PGRST202");
      }
    }),
    { status: 200, allowed: true }
  );
});

test("banned or over-quota players never reach GIPHY; fresh ratings skip it", async () => {
  let calls = 0;
  const fetchGif = async () => {
    calls++;
    return {
      status: 200,
      ok: true,
      json: async () => ({ data: { id: "abc", rating: "g" } })
    };
  };
  const recorded = [];
  const run = consume =>
    verifyGifRating({
      id: "abc",
      apiKey: "key",
      consume,
      fetchGif,
      record: async (...args) => recorded.push(args)
    });
  const failing = error => async () => {
    throw error;
  };
  assert.deepEqual(await run(failing({ message: "ACCOUNT_BANNED" })), {
    status: 403
  });
  assert.deepEqual(await run(failing({ message: "GIF_VERIFY_RATE_LIMITED" })), {
    status: 429
  });
  assert.deepEqual(await run(failing({ message: "boom", code: "08006" })), {
    status: 503
  });
  assert.equal(calls, 0, "no GIPHY call without an admitted request");
  assert.deepEqual(await run(async () => "r"), { status: 200, allowed: false });
  assert.deepEqual(await run(async () => "pg"), { status: 200, allowed: true });
  assert.equal(calls, 0, "a rating verified in the last 7 days skips GIPHY");
  assert.deepEqual(recorded, []);
  // Transitional only: before the migration the RPC does not exist yet.
  assert.deepEqual(await run(failing({ code: "PGRST202" })), {
    status: 200,
    allowed: true
  });
  assert.equal(calls, 1);
  const route = readFileSync("app/api/gifs/verify/route.ts", "utf8");
  assert.ok(
    route.indexOf('client.rpc(\n        "consume_gif_verification"') > 0 ||
      /client\.rpc\(\s*"consume_gif_verification"/.test(route),
    "the limit runs with the player's own session"
  );
});

test("server, client filter and SQL fence share the g, pg and pg-13 set", () => {
  assert.deepEqual([...ALLOWED_GIF_RATINGS], ["g", "pg", "pg-13"]);
  const sql = readFileSync(
    "supabase/migrations/20261028130000_gif_rating_pg13.sql",
    "utf8"
  );
  assert.match(sql, /rating in \('g','pg','pg-13'\)/);
  assert.match(sql, /return clean in \('g','pg','pg-13'\)/);
  const picker = readFileSync("components/gif-picker.tsx", "utf8");
  assert.match(picker, /new Set\(\["g", "pg", "pg-13"\]\)/);
  assert.match(
    picker.replace(/\s+/g, " "),
    /\.filter\(item => ALLOWED_RATINGS\.has\(item\.rating\?\.toLowerCase\(\) \?\? ""\)\)/
  );
  // Verification happens before the GIF is handed to the composer.
  const send = picker.slice(picker.indexOf("const sendSelected"));
  assert.ok(
    send.indexOf("checkGifRating(choice.id)") < send.indexOf("onSelect(choice)")
  );
  assert.match(
    send,
    /if \(verdict === "rejected"\) \{\s+setRejected\(true\);\s+return;/
  );
  assert.match(
    picker,
    /\{rejected && <p role="alert">\{t\("gifPicker\.rejected"\)\}<\/p>\}/
  );
  for (const file of ["messages/en.json", "messages/fr.json"]) {
    const { gifPicker } = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(typeof gifPicker.rejected, "string", file);
    assert.equal(typeof gifPicker.checking, "string", file);
  }
});

test("the client maps the route answer and never blocks on a failure", async () => {
  const source = ts.transpileModule(
    readFileSync("lib/data/gif-rating.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }
  ).outputText;
  const check = async respond => {
    const exports = {};
    vm.runInNewContext(source, { exports, JSON, fetch: respond });
    return exports.checkGifRating("abc");
  };
  const json = (status, body) => async () => ({
    ok: status === 200,
    json: async () => body
  });
  assert.equal(await check(json(200, { allowed: true })), "allowed");
  assert.equal(await check(json(200, { allowed: false })), "rejected");
  assert.equal(await check(json(502, {})), "unknown");
  assert.equal(await check(json(404, {})), "unknown", "route not deployed yet");
  assert.equal(
    await check(async () => {
      throw new Error("offline");
    }),
    "unknown"
  );
});
