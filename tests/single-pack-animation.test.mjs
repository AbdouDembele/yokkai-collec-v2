import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = file =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("pack and rare reveals have one player and no legacy effects underneath", () => {
  const source = read("components/boosters.tsx");
  assert.doesNotMatch(
    source,
    /yk-(?:ssr|lr)-cinematic-stage|yk-pack-tear|runPackOpeningSequence|releasedOpening|releasedCinematics|finalCinematics/
  );
  assert.match(source, /if \(isLR \|\| isSSR\) \{/);
  assert.match(source, /<CardCinematic[^>]*card=\{spot\}/);
  assert.match(source, /<BoosterOpening/);
  const css = read("styles/boosters.css");
  assert.doesNotMatch(
    css,
    /yk-(?:ssr|lr)-(?:nebula|godray|petal|spark|card-glow)|yk-invocation-drift|yk-opening-tension/
  );
});

test("both players retain only transform/opacity and release particle layer hints", () => {
  for (const file of ["booster-opening-document"]) {
    const source = read(`lib/ui/${file}.ts`);
    const script = source.slice(
      source.indexOf("    const optimizeRules="),
      source.indexOf("    const hostOrigin=")
    );
    const removed = [];
    const frame = ["transform", "opacity", "filter", "box-shadow", "width"];
    frame.removeProperty = name => removed.push(name);
    const hint = [];
    const rules = [
      { type: 7, cssRules: [{ style: frame }] },
      {
        type: 1,
        cssRules: [],
        style: { removeProperty: name => hint.push(name) }
      }
    ];
    vm.runInNewContext(script, {
      CSSRule: { KEYFRAMES_RULE: 7 },
      document: { styleSheets: [{ cssRules: rules }] }
    });
    assert.deepEqual(removed, ["filter", "box-shadow", "width"]);
    assert.deepEqual(hint, ["will-change"]);
  }
});
