import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function reader(reply) {
  const exports = {},
    calls = [];
  vm.runInNewContext(
    ts.transpileModule(readFileSync("lib/leaderboard/community.ts", "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }).outputText,
    {
      exports,
      AbortSignal,
      require: name => {
        if (name === "@/lib/data/read-request")
          return { readRequest: fn => fn(new AbortController().signal) };
        assert.equal(name, "@/utils/supabase/client");
        return {
          createClient: () => ({
            rpc: (name, args) => ({
              abortSignal: signal => {
                calls.push({ name, args, signal });
                return Promise.resolve(reply);
              }
            })
          })
        };
      }
    }
  );
  return { ...exports, calls };
}
const player = (userId, value, position = 1) => ({
  userId,
  pseudo: userId,
  value,
  position,
  isFriend: false,
  avatarUrl: null
});
test("All visible co-leaders form one group; lower progress is excluded without inventing a tiebreaker", () => {
  const { leadingLicenseEntries } = reader();
  const tied = Array.from({ length: 90 }, (_, n) => player("player" + n, 100));
  assert.equal(
    leadingLicenseEntries([...tied, player("lower", 99, 91)]).length,
    90
  );
  assert.deepEqual(
    Array.from(
      leadingLicenseEntries([player("first", 18), player("other", 17, 2)]),
      p => p.userId
    ),
    ["first"]
  );
  assert.equal(leadingLicenseEntries([]).length, 0);
  // Privacy filtering belongs to SQL: do not replace a hidden first player.
  const visible = player("visible", 12, 2);
  assert.equal(leadingLicenseEntries([visible])[0].position, 2);
});
test("License preview uses a bounded protected reader independent of overall friends and player searches", async () => {
  const data = {
    entries: [player("a", 19), player("b", 19), player("c", 18, 3)],
    profileStyles: { a: {}, b: {}, c: {} },
    mine: { value: 1, isPublic: false },
    binder: { key: "source:exact", license: "Name", total: 19 }
  };
  const { getLicenseLeaders, calls } = reader({ data, error: null });
  const controller = new AbortController();
  const result = await getLicenseLeaders("source:exact", controller.signal);
  assert.deepEqual(
    Array.from(result.entries, p => p.userId),
    ["a", "b"]
  );
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].args)), {
    p_binder_key: "source:exact",
    p_offset: 0,
    p_limit: 100,
    p_query: "",
    p_friends_only: false
  });
  assert.equal(calls[0].name, "get_license_leaderboard");
  assert.equal(result.mine.isPublic, false);
  assert.equal(result.binder.total, 19);
  assert.equal(calls[0].signal.aborted, false);
  controller.abort();
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(data.entries.length, 3);
});
test("Failed leader read exposes no stale result", async () => {
  const { getLicenseLeaders } = reader({
    data: null,
    error: { message: "denied" }
  });
  await assert.rejects(
    () => getLicenseLeaders("source:exact"),
    /LEADERBOARD_UNAVAILABLE/
  );
});
