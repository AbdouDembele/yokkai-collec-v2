import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";

const require = createRequire(import.meta.url);

test("BBDOU's nine local media files contain actual animation frames", async () => {
  const names = [
    "bbdou-live-banner",
    ...[1, 4, 5, 6, 7, 8, 9, 10].map(slot => `bbdou-showcase-${slot}`)
  ];
  for (const name of names) {
    const metadata = await sharp(`public/assets/premium-examples/${name}.gif`, {
      animated: true
    }).metadata();
    assert.equal(metadata.format, "gif", name);
    assert.ok(metadata.pages > 1, `${name} must be animated`);
    assert.ok(metadata.width > 0 && metadata.pageHeight > 0, name);
  }
});

test("the server starts paused and the client honors reduced motion with a manual toggle", () => {
  const source = readFileSync("components/premium-profile-motion.tsx", "utf8");
  const loaded = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true
      }
    }).outputText,
    { module: loaded, exports: loaded.exports, require }
  );
  const html = renderToStaticMarkup(
    React.createElement(loaded.exports.PremiumProfileMotion)
  );
  assert.match(
    html,
    /aria-label="Play BBDOU&#x27;s banner and showcase animations"/
  );
  assert.match(html, /aria-pressed="false"/);
  assert.doesNotMatch(html, /<img/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /playbackOverride \?\? !reducedMotion/);
  assert.match(source, /setPlaybackOverride\(!playing\)/);
  assert.match(source, /playing &&/);
  assert.match(source, /onError=/);
  assert.doesNotMatch(source, /fetch\(|supabase|https:\/\//);
});

test("Premium embeds the native profile and retains the isolated legacy fallback", () => {
  const page = readFileSync("app/premium/page.tsx", "utf8");
  const offer = readFileSync("components/premium-offer.tsx", "utf8");
  const css = readFileSync("styles/premium.css", "utf8");
  assert.match(page, /profilePreview=\{<PremiumProfileEmbed \/>\}/);
  assert.doesNotMatch(page, /profileMotion=|bbdou-profile\.png/);
  assert.match(offer, /profilePreview \?\? \(/);
  const native = readFileSync("components/premium-profile-embed.tsx", "utf8");
  assert.match(native, /<YokaiCard/);
  assert.match(native, /aria-pressed=\{playing\}/);
  assert.match(native, /prefers-reduced-motion: reduce/);
  assert.match(native, /fallbackImage=\{card.still\}/);
  assert.match(offer, /bbdou-profile\.png/);
  assert.match(offer, /\{profileMotion\}/);
  assert.match(css, /\.yk-pro-profile-photo-crop > img\s*\{/);
  assert.match(css, /\.yk-pro-profile-motion-toggle:focus-visible/);
  assert.match(
    css,
    /\.yk-pro-profile-motion-media\.is-card\s*\{[^}]*mask-image/
  );
});
