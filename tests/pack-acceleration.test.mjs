import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("pack advance is delegated only to the final iframe player", () => {
  const source = readFileSync("components/boosters.tsx", "utf8");
  const body = source.match(
    /const speedUpSeal = \(\) => \{([\s\S]*?)\n  \};/
  )[1];
  const messages = [];
  const advance = new Function(
    "openingStage",
    "clickToOpen",
    "finishOpening",
    body
  );
  const stage = {
    current: {
      querySelector: selector => {
        assert.equal(selector, "iframe");
        return {
          contentWindow: { postMessage: (...args) => messages.push(args) }
        };
      }
    }
  };
  const finish = {
    current: () => assert.fail("the iframe owns non-click advancement")
  };
  advance(stage, false, finish);
  advance(stage, false, finish);
  assert.deepEqual(messages, [
    [{ type: "yokkai-booster-next-step" }, "*"],
    [{ type: "yokkai-booster-next-step" }, "*"]
  ]);
  assert.doesNotMatch(body, /onOpen|setOpeningPhase|setTimeout/);
  assert.doesNotMatch(source, /accelerateSeal|updatePlaybackRate/);
});
