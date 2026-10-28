import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import postcss from "postcss";
const require = createRequire(import.meta.url);
const css = postcss.parse(readFileSync("styles/ambient-glow.css", "utf8"));

test("shared Packs halo retains its original static rendering and styling", () => {
  const rule = css.nodes.find(node => node.selector === ".yk-pack-ambient");
  const values = Object.fromEntries(
    rule.nodes.map(node => [node.prop, node.value])
  );
  assert.equal(values.position, "absolute");
  assert.equal(values["z-index"], "-1");
  assert.equal(values.inset, "0");
  assert.equal(values.filter, "blur(32px)");
  assert.equal(values["pointer-events"], "none");
  assert.match(values.background, /ellipse at 50% 0%/);
  assert.match(values.background, /var\(--color-accent-neon\) 10%/);
  assert.match(values.background, /transparent 65%/);
  assert.equal(values.animation, undefined);
});

test("ambient motion only composites transforms and opacity, with static reduced motion", () => {
  css.walkAtRules("keyframes", frames => {
    frames.walkDecls(decl =>
      assert.ok(["transform", "opacity"].includes(decl.prop), decl.prop)
    );
  });
  const reduced = css.nodes.find(
    node => node.params === "(prefers-reduced-motion: reduce)"
  );
  assert.ok(reduced);
  assert.equal(
    reduced.nodes[0].selector,
    ".yk-home-ambient > span:nth-child(n)",
    "reduced motion overrides each per-halo animation name"
  );
  assert.ok(
    reduced.nodes.some(rule =>
      rule.nodes.some(
        decl => decl.prop === "animation" && decl.value === "none"
      )
    )
  );
  const mobile = css.nodes.find(node => node.params === "(max-width: 639px)");
  assert.ok(
    mobile.nodes.some(
      rule =>
        rule.selector.includes("nth-child(3)") &&
        rule.nodes.some(
          decl => decl.prop === "display" && decl.value === "none"
        )
    )
  );
});

test("home halo starts paused, follows tab visibility and removes its listener", () => {
  let effect;
  const node = { dataset: {} };
  const listeners = new Map();
  const document = {
    visibilityState: "hidden",
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name, fn) => {
      assert.equal(listeners.get(name), fn);
      listeners.delete(name);
    }
  };
  const loadedModule = { exports: {} };
  const imports = {
    react: {
      ...React,
      useEffect: fn => {
        effect = fn;
      },
      useRef: () => ({ current: node })
    },
    "@/styles/ambient-glow.css": {}
  };
  const js = ts.transpileModule(
    readFileSync("components/ambient-glow.tsx", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX
      }
    }
  ).outputText;
  vm.runInNewContext(js, {
    module: loadedModule,
    exports: loadedModule.exports,
    document,
    require: name => imports[name] ?? require(name)
  });
  const { AmbientGlow } = loadedModule.exports;
  assert.equal(
    renderToStaticMarkup(React.createElement(AmbientGlow)),
    '<span class="yk-pack-ambient" aria-hidden="true"></span>'
  );
  const html = renderToStaticMarkup(
    React.createElement(AmbientGlow, { variant: "home" })
  );
  assert.match(html, /aria-hidden="true" data-paused="true"/);
  assert.equal((html.match(/<span/g) ?? []).length, 3);
  const cleanup = effect();
  assert.equal(node.dataset.paused, "true");
  document.visibilityState = "visible";
  listeners.get("visibilitychange")();
  assert.equal(node.dataset.paused, "false");
  document.visibilityState = "hidden";
  listeners.get("visibilitychange")();
  assert.equal(node.dataset.paused, "true");
  cleanup();
  assert.equal(listeners.size, 0);
});
