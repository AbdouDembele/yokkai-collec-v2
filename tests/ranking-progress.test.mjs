import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createTranslator } from "next-intl";
const exports = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync("lib/leaderboard/progress.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
  }).outputText,
  { exports }
);
const { personalRankGoal } = exports;
test("personal targets use the closest visible higher score and require one more point", () => {
  const entries = [
    { userId: "me", pseudo: "Me", score: 50 },
    { userId: "far", pseudo: "Far", score: 1000 },
    { userId: "near", pseudo: "Near", score: 75 }
  ];
  const goal = personalRankGoal(
    "collection",
    "me",
    { score: 50, position: 3 },
    entries
  );
  assert.equal(goal.type, "target");
  assert.equal(goal.count, 26);
  assert.equal(goal.pseudo, "Near");
  assert.equal(entries[1].userId, "far");
});
test("leaders and zero-like profiles receive honest goals without fake opponents", () => {
  assert.equal(
    personalRankGoal("likes", "me", { value: 5, position: 1 }, []).type,
    "leader"
  );
  assert.equal(
    personalRankGoal("likes", "me", { value: 0, position: null }, []).type,
    "firstLike"
  );
  assert.equal(
    personalRankGoal("collection", "me", { score: 0, position: null }, []).type,
    "start"
  );
});
test("goal and trend copy uses ICU plurals in EN and FR", () => {
  for (const locale of ["en", "fr"]) {
    const messages = JSON.parse(
      readFileSync("messages/" + locale + ".json", "utf8")
    );
    const t = createTranslator({
      locale,
      messages,
      namespace: "rankingProgress"
    });
    for (const count of [1, 3]) {
      assert(
        t("finishLicense", { count, license: "Kingdom" }).includes("Kingdom")
      );
      assert(t("up", { count }).includes(String(count)));
      assert(t("likesTarget", { count, player: "Alice" }).includes("Alice"));
    }
  }
});

test("a ranked player outside the visible results is never told they have zero progress", () => {
  assert.equal(
    personalRankGoal("likes", "me", { value: 12, position: 150 }, []).type,
    "progress"
  );
  assert.equal(
    personalRankGoal("collection", "me", { score: 500, position: null }, [])
      .type,
    "progress"
  );
});
