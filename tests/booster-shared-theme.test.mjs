import { intl } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const source = readFileSync(
  new URL("../styles/boosters-showcase.css", import.meta.url),
  "utf8"
);
const root = postcss.parse(source);
const rule = selector =>
  root.nodes.find(node => node.type === "rule" && node.selector === selector);
const value = (selector, property) =>
  rule(selector)?.nodes.find(node => node.prop === property)?.value;
const tokens = readFileSync(
  new URL("../tailwind.config.ts", import.meta.url),
  "utf8"
);
// Two complete product palettes during the reviewed midnight-blue rollout.
// Selecting one accent requires every other checked token from the same palette.
const midnight = tokens.includes('"pack-accent": "#bccdff"');
const midnightTokens = {
  "pack-accent": "#bccdff",
  "pack-button-start": "#0d1728",
  "pack-button-middle": "#080f1c",
  "pack-button-end": "#101b2e"
};
const token = (name, literal) => {
  if (midnight) literal = midnightTokens[name] ?? literal;
  assert.match(tokens, new RegExp(`"${name}": "${literal}"`));
  return `var(--color-${name})`;
};
const panels = ".yk-pack-grid .yk-pack-panel";

test("both floating packs preserve one complete approved UI palette through exact tokens", () => {
  assert.equal(value(panels, "--pack-accent"), token("pack-accent", "#c0c5ff"));
  assert.equal(value(panels, "color"), token("pack-ink", "#eeebff"));
  assert.equal(value(panels, "border"), "0");
  assert.equal(value(panels, "background"), "none");
  assert.equal(value(panels, "box-shadow"), "none");
  assert.equal(
    value(`${panels} .yk-pack-body > .yk-button`, "color"),
    token("pack-button-ink", "#eeeaff")
  );
  const background = value(
    `${panels} .yk-pack-body > .yk-button`,
    "background"
  );
  for (const [name, literal] of [
    ["pack-button-start", "#4a436f"],
    ["pack-button-middle", "#36476d"],
    ["pack-button-end", "#4c406c"]
  ]) {
    assert.ok(background.includes(token(name, literal)));
  }
  assert.doesNotMatch(source, /#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
  assert.doesNotMatch(source, /url\(|yk-opening|yk-reveal/);
});

test("the shared pack theme covers image glow, readable status and disabled controls", () => {
  for (const suffix of [
    ".yk-pack-art-stage",
    ".yk-pack-image",
    ".yk-pack-info",
    ".yk-pack-status",
    ".yk-pack-status .text-success",
    ".yk-pack-status .text-warning",
    ".yk-pack-body > .yk-button:disabled"
  ])
    assert.ok(rule(`${panels} ${suffix}`), suffix);
  assert.equal(
    value(`${panels} .yk-pack-status .text-success`, "color"),
    token("pack-success", "#72d6bc")
  );
  assert.ok(
    root.nodes.some(
      node =>
        node.type === "atrule" &&
        node.params.includes("hover: hover") &&
        node.nodes.some(child => child.selector === `${panels}:hover`)
    )
  );
});

test("reserve dots and accessible count reflect server values including empty and full", async () => {
  const { transpileModule, JsxEmit } = await import("typescript");
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const boosters = readFileSync(
    new URL("../components/boosters.tsx", import.meta.url),
    "utf8"
  );
  const fragment = boosters.match(
    /<div className="yk-pack-reserve"[\s\S]*?<\/div>/
  )?.[0];
  assert.ok(fragment);
  const compiled = transpileModule(`const reserve = ${fragment};`, {
    compilerOptions: { jsx: JsxEmit.React }
  }).outputText;
  const render = new Function(
    "React",
    "status",
    "tp",
    `${compiled}; return reserve;`
  );
  for (const [available, maximum] of [
    [0, 5],
    [3, 5],
    [5, 5],
    [2, 4]
  ]) {
    const html = renderToStaticMarkup(
      render(React, { available, maximum }, intl.useTranslations("packs"))
    );
    assert.ok(
      html.includes(`aria-label="${available} of ${maximum} packs in reserve"`)
    );
    assert.equal((html.match(/data-filled="true"/g) || []).length, available);
    assert.equal((html.match(/data-filled=/g) || []).length, maximum);
  }
});
