import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
vm.runInNewContext(
  ts.transpileModule(
    readFileSync(new URL("../lib/ui/banner-frame.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }
  ).outputText,
  { exports }
);
const { bannerGeometry, normalizeBannerFrame, panBanner, BANNER_ASPECT } =
  exports;
const center = { x: 50, y: 50, zoom: 1 };

test("quarter turns cycle through all four orientations and keep the complete image visible in fit mode", () => {
  for (const aspect of [0.2, 0.66, 1, 2.3, 4, 10]) {
    let frame = { ...center, zoom: bannerGeometry(aspect, center).minZoom };
    for (const rotation of [90, 180, 270, 0]) {
      frame = exports.rotateBanner(frame, aspect);
      assert.equal(frame.rotation, rotation);
      const geometry = bannerGeometry(aspect, frame);
      assert.equal(geometry.rotation, rotation);
      assert.ok(geometry.overflowX < 1e-9 && geometry.overflowY < 1e-9);
      const fittedHeight = Math.min(BANNER_ASPECT / aspect, 1);
      const quarterTurn = rotation === 90 || rotation === 270;
      const width =
        (quarterTurn ? fittedHeight : aspect * fittedHeight) * geometry.scale;
      const height =
        (quarterTurn ? aspect * fittedHeight : fittedHeight) * geometry.scale;
      assert.ok(width <= BANNER_ASPECT + 1e-9);
      assert.ok(height <= 1 + 1e-9);
      assert.ok(
        Math.abs(width - BANNER_ASPECT) < 1e-9 || Math.abs(height - 1) < 1e-9
      );
    }
  }
});

test("rotation remains bounded while panning and resets invalid angles safely", () => {
  for (const rotation of [0, 90, 180, 270]) {
    const frame = { ...center, rotation, zoom: 1.8 };
    const moved = panBanner(frame, 0.66, 0.1, -0.1);
    assert.equal(moved.rotation, rotation);
    assert.ok(moved.x >= 0 && moved.x <= 100 && moved.y >= 0 && moved.y <= 100);
  }
  for (const rotation of [NaN, Infinity, -90, 45, 360]) {
    assert.equal(normalizeBannerFrame({ ...center, rotation }).rotation, 0);
  }
});

test("banner framing fits every image ratio without changing its proportions", () => {
  for (const aspect of [0.2, 0.66, 1, 2.3, 4, 10]) {
    const initial = bannerGeometry(aspect, center);
    assert.ok(initial.minZoom > 0 && initial.minZoom <= 1);
    const full = bannerGeometry(aspect, { ...center, zoom: initial.minZoom });
    assert.ok(Math.abs(full.scale - 1) < 1e-10);
    assert.ok(full.overflowX < 1e-10 && full.overflowY < 1e-10);
    assert.equal(full.offsetX, 0);
    assert.equal(full.offsetY, 0);
  }
  assert.equal(bannerGeometry(BANNER_ASPECT, center).scale, 1);
});

test("dragging is bounded, independent of viewport size and keeps the image inside its possible crop", () => {
  for (const aspect of [0.66, 1, 4]) {
    const moved = panBanner(center, aspect, 0.1, -0.2);
    const geometry = bannerGeometry(aspect, moved);
    assert.ok(moved.x >= 0 && moved.x <= 100 && moved.y >= 0 && moved.y <= 100);
    assert.ok(Math.abs(geometry.offsetX) <= 50 * geometry.overflowX);
    assert.ok(Math.abs(geometry.offsetY) <= 50 * geometry.overflowY);
    const edge = panBanner(center, aspect, 1000, -1000);
    assert.ok(edge.x === 0 || edge.x === 50);
    assert.ok(edge.y === 100 || edge.y === 50);
  }
  const full = bannerGeometry(0.66, center);
  const fit = { ...center, zoom: full.minZoom };
  assert.equal(panBanner(fit, 0.66, 20, 20).x, 50);
  assert.equal(panBanner(fit, 0.66, 20, 20).y, 50);
});

test("invalid client metadata cannot generate NaN or unbounded transforms", () => {
  for (const frame of [
    { x: NaN, y: Infinity, zoom: NaN },
    { x: -999, y: 999, zoom: 999 }
  ]) {
    const safe = normalizeBannerFrame(frame);
    assert.ok(safe.x >= 0 && safe.x <= 100 && safe.y >= 0 && safe.y <= 100);
    assert.ok(safe.zoom >= 0.01 && safe.zoom <= 4);
    for (const value of Object.values(bannerGeometry(NaN, safe)))
      assert.ok(Number.isFinite(value));
  }
});
