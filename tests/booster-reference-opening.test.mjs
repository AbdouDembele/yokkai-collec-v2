import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";
import vm from "node:vm";

const source = readFileSync(
  new URL("../data/booster-opening/reveal.html", import.meta.url),
  "utf8"
);

test("reference opening replaces the old sequence with one 2.94s tear and five-card fan", () => {
  assert.match(source, /data-yokkai-opening="tear-and-fan"/);
  assert.equal((source.match(/class="opening-card"/g) ?? []).length, 5);
  assert.match(source, /foil-peel 0\.67s[^;]*0\.68s/);
  assert.match(source, /booster-fan 1\.05s/);
  assert.match(source, /booster-progress 2\.94s/);
  assert.doesNotMatch(
    source,
    /data:image|<canvas|AudioContext|setInterval|foil-opening|sheen-behind/
  );
  const css = postcss.parse(source.match(/<style>([\s\S]*?)<\/style>/)[1]);
  css.walkAtRules("keyframes", animation =>
    animation.walkDecls(declaration => {
      assert.ok(
        ["transform", "opacity", "animation-timing-function"].includes(
          declaration.prop
        ),
        declaration.toString()
      );
    })
  );
  for (const selector of [".running .ring", ".running .opening-particles i"]) {
    const rule = css.nodes.find(
      node => node.type === "rule" && node.selector === selector
    );
    const animation = rule.nodes.find(node => node.prop === "animation").value;
    assert.match(animation, /forwards/);
    assert.doesNotMatch(
      animation,
      /\bboth\b|backwards/,
      `${selector} must stay invisible before its delay, rather than stack at its emission point`
    );
  }
  assert.match(source, /prefers-reduced-motion/);
  assert.doesNotMatch(source, /will-change/);
  const adapter = readFileSync(
    new URL("../lib/ui/booster-opening-document.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    adapter,
    /\.yokkai-await-click \.scene\.running \*/,
    "Closed-pack guards must outrank the reduced-motion fade until the first click"
  );
});

test("disposing a loading opening clears image timeouts, image listeners and the resize frame", async () => {
  const timers = new Map(),
    listeners = new Map(),
    images = [],
    removed = [];
  let timerId = 0,
    cancelledFrame;
  class ImageMock {
    complete = false;
    handlers = new Map();
    constructor() {
      images.push(this);
    }
    addEventListener(name, handler) {
      this.handlers.set(name, handler);
    }
    removeEventListener(name) {
      this.handlers.delete(name);
    }
  }
  const window = {
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: name => removed.push(name),
    visualViewport: {
      addEventListener() {},
      removeEventListener: name => removed.push(`viewport:${name}`)
    }
  };
  vm.runInNewContext(source.match(/<script>([\s\S]*?)<\/script>/)[1], {
    window,
    document: { getElementById: () => ({ style: { setProperty() {} } }) },
    Image: ImageMock,
    setTimeout: fn => {
      timers.set(++timerId, fn);
      return timerId;
    },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: () => 42,
    cancelAnimationFrame: id => {
      cancelledFrame = id;
    }
  });
  const loading = window.setYokkaiBooster({
    boosterImage:
      "https://yokkai-collec.com/assets/chrome-regular-booster-v1.png"
  });
  assert.equal(timers.size, 2);
  listeners.get("resize")();
  listeners.get("pagehide")();
  await assert.rejects(loading, /Booster image unavailable/);
  assert.equal(timers.size, 0);
  assert.ok(images.every(image => image.handlers.size === 0));
  assert.equal(cancelledFrame, 42);
  assert.deepEqual(removed, ["resize", "viewport:resize"]);
});
