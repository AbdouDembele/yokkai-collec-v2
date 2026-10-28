import { intl } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const profile = JSON.parse(
  readFileSync("lib/premium/profile-example.json", "utf8")
);
function renderProfile(playing) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true
      }
    }).outputText;
    vm.runInNewContext(code, {
      module: mod,
      exports: mod.exports,
      require: id => {
        if (id === "next-intl") return intl;
        if (id.endsWith(".css")) return {};
        if (id === "react")
          return { ...React, useSyncExternalStore: () => !playing };
        if (id === "@/components/pro-access") return {};
        if (id.startsWith("@/")) {
          const path = resolve(id.slice(2));
          if (id.endsWith(".json"))
            return JSON.parse(readFileSync(path, "utf8"));
          return load(existsSync(path + ".tsx") ? path + ".tsx" : path + ".ts");
        }
        return require(id);
      }
    });
    return mod.exports;
  }
  const { PremiumProfileEmbed } = load(
    resolve("components/premium-profile-embed.tsx")
  );
  return renderToStaticMarkup(React.createElement(PremiumProfileEmbed));
}

test("the native profile renders BBDOU's name, cosmetics and ten real card components, not a screenshot", () => {
  const html = renderProfile(false);
  assert.match(html, /BBDOU/);
  assert.match(html, /data-name-effect="pop"/);
  assert.match(html, /crystal decorative badge/);
  assert.match(html, /Featured cards/);
  assert.equal((html.match(/class="yk-card yk-rarity-/g) || []).length, 10);
  for (const card of profile.cards) assert.ok(html.includes(card.name));
  assert.match(html, /href="\/profile\/BBDOU"/);
  assert.doesNotMatch(
    html,
    /bbdou-profile\.png|<iframe|yk-pro-profile-motion-media|Edit showcase/
  );
});

test("playback uses the eight real GIFs and banner; paused mode uses only static local media", () => {
  const paused = renderProfile(false),
    playing = renderProfile(true);
  assert.match(paused, /aria-pressed="false"/);
  assert.match(playing, /aria-pressed="true"/);
  assert.doesNotMatch(paused, /src="[^\"]+\.gif/);
  for (const card of profile.cards.filter(c => c.animated))
    assert.ok(playing.includes(card.animated));
  assert.ok(playing.includes(profile.banner));
  assert.equal(profile.cards.filter(c => c.animated).length, 8);
  assert.match(paused, /bbdou-banner-still/);
});

test("the promotional snapshot contains local visual data only and keeps native cards responsive", () => {
  assert.equal(profile.cards.length, 10);
  for (const card of profile.cards) {
    assert.ok(existsSync("public" + card.still));
    if (card.animated) assert.ok(existsSync("public" + card.animated));
  }
  assert.doesNotMatch(
    JSON.stringify(profile),
    /https?:|user_id|instanceId|email|bio|token|secret/i
  );
  const source = readFileSync("components/premium-profile-embed.tsx", "utf8");
  assert.doesNotMatch(source, /fetch\(|supabase|\.rpc\(/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /fallbackImage=\{card.still\}/);
  const css = readFileSync("styles/premium.css", "utf8");
  assert.match(
    css,
    /\.yk-pro-native-cards\s*\{[^}]*repeat\(5, minmax\(0, 1fr\)\)/
  );
  assert.match(
    css,
    /@media \(max-width: 600px\)\s*\{\s*\.yk-pro-native-cards\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/
  );
});
