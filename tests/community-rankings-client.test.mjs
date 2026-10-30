import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";

function client() {
  const exports = {},
    calls = [];
  let reply = { data: { entries: [] }, error: null };
  const signal = new AbortController().signal;
  vm.runInNewContext(
    ts.transpileModule(readFileSync("lib/leaderboard/community.ts", "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }).outputText,
    {
      exports,
      Math,
      require: name => {
        if (name === "@/utils/supabase/client")
          return {
            createClient: () => ({
              rpc: (name, args) => ({
                abortSignal: given => {
                  assert.equal(given, signal);
                  calls.push({ name, args });
                  return Promise.resolve(reply);
                }
              })
            })
          };
        if (name === "@/lib/data/read-request")
          return { readRequest: callback => callback(signal) };
        throw Error("Unexpected import " + name);
      }
    }
  );
  return {
    ...exports,
    calls,
    respond: value => {
      reply = value;
    }
  };
}
test("new ranking reads use separate bounded endpoints, exact binder identities and translated failure codes", async () => {
  const api = client(),
    options = { offset: 20, query: "Collector", friendsOnly: true };
  await api.getCommunityRanking("likes", options);
  await api.getCommunityRanking("licenses", options, "source:exact-identity");
  assert.deepEqual(JSON.parse(JSON.stringify(api.calls)), [
    {
      name: "get_profile_likes_leaderboard",
      args: {
        p_offset: 20,
        p_limit: 20,
        p_query: "Collector",
        p_friends_only: true
      }
    },
    {
      name: "get_license_leaderboard",
      args: {
        p_offset: 20,
        p_limit: 20,
        p_query: "Collector",
        p_friends_only: true,
        p_binder_key: "source:exact-identity"
      }
    }
  ]);
  api.respond({ data: null, error: { message: "private backend detail" } });
  await assert.rejects(
    api.getCommunityRanking("likes", options),
    /LEADERBOARD_UNAVAILABLE/
  );
  api.respond({ data: null, error: null });
  await assert.rejects(
    api.getCommunityRanking("licenses", options, "key"),
    /LEADERBOARD_UNAVAILABLE/
  );
});
test("completion never rounds an unfinished license to 100 percent", () => {
  const { completionRatio } = client();
  assert.equal(completionRatio(9999, 10000), 0.999);
  assert.equal(completionRatio(3, 4), 0.75);
  assert.equal(completionRatio(4, 4), 1);
  assert.equal(completionRatio(0, 0), 0);
});
