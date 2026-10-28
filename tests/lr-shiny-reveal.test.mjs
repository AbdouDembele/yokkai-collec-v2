import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import ts from "typescript";
import postcss from "postcss";

const require = createRequire(import.meta.url);
const read = file =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const descendants = node =>
  !node || typeof node !== "object"
    ? []
    : [
        node,
        ...React.Children.toArray(node.props?.children).flatMap(descendants)
      ];

test("V7 releases the transitional worlds and space particles; Replay starts one fresh scene", () => {
  const states = [];
  let index = 0;
  const exports = {};
  const source = read("components/lr-shiny-scenery.tsx");
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX
      }
    }).outputText,
    {
      exports,
      require: name =>
        name === "react"
          ? {
              ...React,
              useState: initial => {
                const position = index++;
                if (!(position in states)) states[position] = initial;
                return [
                  states[position],
                  value => {
                    states[position] = value;
                  }
                ];
              }
            }
          : name.endsWith(".css")
            ? {}
            : require(name)
    }
  );
  const render = () => {
    index = 0;
    return descendants(
      exports.LrShinyScenery({ streaks: [[40, -20, 5.6, 0]] })
    );
  };
  const find = (nodes, name) =>
    nodes.find(node => node.props?.className === name);
  let nodes = render();
  const stars = find(nodes, "yk-shiny-stars").props.children;
  assert.equal(stars.length, 64);
  assert.equal(find(nodes, "yk-shiny-warp").props.children.length, 25);
  assert.equal(find(nodes, "yk-shiny-glints").props.children.length, 24);
  assert.equal(find(nodes, "yk-shiny-streaks").props.children.length, 8);
  find(nodes, "yk-shiny-prelude").props.onAnimationEnd({
    animationName: "yk-lr-glitter"
  });
  assert.ok(find(render(), "yk-shiny-prelude"));
  find(nodes, "yk-shiny-prelude").props.onAnimationEnd({
    animationName: "yk-shiny-crt-close"
  });
  nodes = render();
  assert.equal(find(nodes, "yk-shiny-prelude"), undefined);
  find(nodes, "yk-shiny-cosmos").props.onAnimationEnd({
    animationName: "yk-shiny-cosmos"
  });
  assert.ok(find(render(), "yk-shiny-cosmos"));
  find(nodes, "yk-shiny-cosmos").props.onAnimationEnd({
    animationName: "yk-shiny-nebula"
  });
  nodes = render();
  assert.equal(find(nodes, "yk-shiny-cosmos"), undefined);
  assert.ok(find(nodes, "yk-shiny-rose-world"));
  states.length = 0; // The shared controller remounts the entire scene on Replay.
  nodes = render();
  assert.ok(find(nodes, "yk-shiny-prelude"));
  assert.deepEqual(
    find(nodes, "yk-shiny-stars").props.children.map(node => node.props.style),
    stars.map(node => node.props.style)
  );
  assert.equal(
    nodes.filter(node => node.props?.className === "yk-shiny-scene").length,
    1
  );
  assert.doesNotMatch(
    source,
    /iframe|requestAnimationFrame|setTimeout|setInterval|new Image|new Audio|canvas/
  );
});

test("V7 keeps the final reference chronology, shared card design and compositor-only animation", () => {
  const css = read("styles/lr-shiny-reveal.css");
  const ast = postcss.parse(css);
  const rules = new Map();
  ast.walkRules(rule => {
    if (rule.parent.type === "atrule" && rule.parent.name === "keyframes") {
      rule.walkDecls(decl =>
        assert.ok(
          ["transform", "opacity", "animation-timing-function"].includes(
            decl.prop
          ),
          decl.toString()
        )
      );
      return;
    }
    assert.doesNotMatch(rule.selector, /(^|,)\s*(html|body|:root|\*)/);
    if (/\.yk-card-cinematic-shiny\s+\.yk-card[-\s.]/.test(rule.selector)) {
      assert.match(
        rule.selector,
        /^\.yk-lr-reveal\.yk-card-cinematic-shiny /,
        "Shiny element timings must outrank the shared LR selectors in either stylesheet order"
      );
      rule.walkDecls(decl =>
        assert.ok(decl.prop.startsWith("animation"), decl.toString())
      );
    }
    if (rule.parent.type === "root") rules.set(rule.selector, rule.toString());
  });
  for (const [selector, cue] of [
    [".yk-shiny-gold-world", "13.35s"],
    [".yk-shiny-cosmos", "16.43s"],
    [".yk-shiny-relight", "19.1s"],
    [".yk-shiny-rose-world", "19.6s"],
    [".yk-card-cinematic-shiny .yk-lr-stage", "21.2s"]
  ])
    assert.ok(rules.get(selector)?.includes(cue), `${selector}: ${cue}`);
  assert.match(css, /23\.53s/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /will-change|data:image|https?:/);
  for (const [, asset] of css.matchAll(/url\("(.*?)"\)/g))
    assert.ok(existsSync(new URL(`../public${asset}`, import.meta.url)));
});
