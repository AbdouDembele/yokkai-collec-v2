import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

test("Home carousel uses six-row protected readers, exact global mode and no polling-dependent writes", async () => {
  const exports = {},
    calls = [],
    signal = new AbortController().signal;
  let stable = true,
    reply = { data: { entries: [] }, error: null };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync("lib/leaderboard/home-carousel.ts", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022
        }
      }
    ).outputText,
    {
      exports,
      require: name => {
        if (name === "@/utils/supabase/client")
          return {
            createClient: () => ({
              rpc: (name, args) => ({
                abortSignal: s => {
                  assert.equal(s, signal);
                  calls.push({ name, args });
                  return Promise.resolve(reply);
                }
              })
            })
          };
        if (name === "@/lib/data/read-request")
          return { readRequest: fn => fn(signal) };
        if (name === "@/lib/data/binders")
          return { stableBindersEnabled: () => stable };
        throw Error(name);
      }
    }
  );
  await exports.getHomeCommunityRanking("likes");
  await exports.getHomeCommunityRanking("licenses");
  stable = false;
  await exports.getHomeCommunityRanking("licenses");
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      name: "get_profile_likes_leaderboard",
      args: { p_offset: 0, p_limit: 6, p_query: "", p_friends_only: false }
    },
    {
      name: "get_license_leaderboard",
      args: {
        p_offset: 0,
        p_limit: 6,
        p_query: "",
        p_friends_only: false,
        p_binder_key: "global:progress-score"
      }
    },
    {
      name: "get_license_leaderboard",
      args: {
        p_offset: 0,
        p_limit: 6,
        p_query: "",
        p_friends_only: false,
        p_binder_key: "global:progress-score:legacy"
      }
    }
  ]);
  assert.equal(exports.homeRankingHref("collection"), "/leaderboard");
  assert.equal(exports.homeRankingHref("likes"), "/leaderboard?ranking=likes");
  assert.equal(
    exports.homeRankingHref("licenses"),
    "/leaderboard?ranking=licenses"
  );
  assert.deepEqual(
    [...exports.HOME_RANKING_KINDS],
    ["collection", "likes", "licenses"]
  );
  assert.equal(exports.HOME_RANKING_INTERVAL_MS, 5000);
  reply = { data: null, error: { message: "backend private detail" } };
  await assert.rejects(
    exports.getHomeCommunityRanking("likes"),
    /LEADERBOARD_UNAVAILABLE/
  );
});
