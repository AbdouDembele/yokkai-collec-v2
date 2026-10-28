import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

test("wheel loops in both directions without moving the page", () => {
  const loaded = { exports: {} };
  let resize, recenter;
  const clones = [{ hidden: false }, { hidden: false }];
  vm.runInNewContext(
    ts.transpileModule(readFileSync("lib/ui/horizontal-wheel.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS }
    }).outputText,
    {
      exports: loaded.exports,
      document: { activeElement: null },
      ResizeObserver: class {
        constructor(callback) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      }
    }
  );
  let listener;
  const period = { offsetWidth: 1000 };
  const element = {
    scrollLeft: 0,
    scrollWidth: 3000,
    querySelector: () => period,
    querySelectorAll: () => clones,
    contains: () => false,
    clientWidth: 200,
    addEventListener(name, fn, options) {
      if (name === "scroll") {
        recenter = fn;
        return;
      }
      assert.equal(options.passive, false);
      listener = fn;
    },
    removeEventListener(name, fn) {
      if (name !== "wheel") return;
      assert.equal(fn, listener);
      listener = null;
    }
  };
  const cleanup = loaded.exports.enableHorizontalWheel(element);
  assert.equal(element.scrollLeft, 1000);
  element.scrollLeft = 995;
  recenter();
  assert.equal(element.scrollLeft, 1995);
  element.scrollLeft = 2005;
  recenter();
  assert.equal(element.scrollLeft, 1005);
  element.scrollLeft = 1000;
  const wheel = (deltaY, overrides = {}) => {
    let prevented = false;
    listener({
      deltaY,
      deltaX: 0,
      deltaMode: 0,
      ctrlKey: false,
      preventDefault() {
        prevented = true;
      },
      ...overrides
    });
    return prevented;
  };
  assert.equal(wheel(-10), true);
  assert.equal(element.scrollLeft, 1990);
  assert.equal(wheel(10), true);
  assert.equal(element.scrollLeft, 1000);
  assert.equal(wheel(120), true);
  assert.equal(element.scrollLeft, 1120);
  assert.equal(wheel(2, { deltaMode: 1 }), true);
  assert.equal(element.scrollLeft, 1152);
  assert.equal(wheel(100, { ctrlKey: true }), false);
  assert.equal(wheel(2, { deltaX: 30 }), true);
  assert.equal(element.scrollLeft, 1182);
  assert.equal(wheel(10000), true);
  assert.equal(element.scrollLeft, 1182);
  assert.equal(wheel(900), true);
  assert.equal(element.scrollLeft, 1082);
  assert.equal(wheel(-200), true);
  assert.equal(element.scrollLeft, 1882);
  period.offsetWidth = 100;
  resize();
  assert.ok(clones.every(copy => copy.hidden));
  period.offsetWidth = 1000;
  resize();
  assert.ok(clones.every(copy => !copy.hidden));
  period.offsetWidth = 0;
  element.scrollWidth = element.clientWidth;
  assert.equal(wheel(120), false);
  assert.equal(wheel(0), false);
  cleanup();
  assert.equal(listener, null);
});

test("automatic scrolling yields to interaction, reduced motion and hidden tabs", () => {
  const loaded = { exports: {} },
    listeners = new Map(),
    globalListeners = new Map();
  let now = 0,
    timer,
    animation,
    count = 0,
    hovered = false,
    disconnected = false;
  const motion = {
    matches: false,
    addEventListener: (name, fn) => globalListeners.set("motion", fn),
    removeEventListener: () => globalListeners.delete("motion")
  };
  const document = {
    hidden: false,
    addEventListener: (name, fn) => globalListeners.set(name, fn),
    removeEventListener: name => globalListeners.delete(name)
  };
  const period = { offsetWidth: 1000 };
  const element = {
    scrollLeft: 1100,
    scrollWidth: 3000,
    clientWidth: 200,
    querySelector: () => period,
    firstElementChild: {
      animate(frames, options) {
        assert.equal(frames[1].transform, "translateX(-1000px)");
        assert.equal(options.duration, 25000);
        assert.equal(options.iterations, Infinity);
        assert.equal(options.easing, "linear");
        count++;
        animation = {
          currentTime: 0,
          cancelled: false,
          cancel() {
            this.cancelled = true;
          }
        };
        return animation;
      }
    },
    matches: () => hovered,
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name)
  };
  vm.runInNewContext(
    ts.transpileModule(readFileSync("lib/ui/horizontal-wheel.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS }
    }).outputText,
    {
      exports: loaded.exports,
      document,
      Date: { now: () => now },
      window: { matchMedia: () => motion },
      setTimeout: fn => {
        timer = fn;
        return 1;
      },
      clearTimeout: () => {
        timer = undefined;
      },
      ResizeObserver: class {
        observe() {}
        disconnect() {
          disconnected = true;
        }
      }
    }
  );
  const cleanup = loaded.exports.enableAutomaticScroll(element);
  assert.equal(count, 1);
  assert.equal(element.scrollLeft, 1000);
  assert.equal(animation.currentTime, 2500);
  animation.currentTime = 3000;
  hovered = true;
  listeners.get("mouseenter")();
  assert.equal(animation.cancelled, true);
  assert.equal(element.scrollLeft, 1120);
  listeners.get("wheel")();
  element.scrollLeft = 1400;
  now = 5000;
  hovered = false;
  timer();
  assert.equal(count, 1);
  assert.equal(element.scrollLeft, 1400);
  now = 6001;
  timer();
  assert.equal(count, 2);
  assert.equal(animation.currentTime, 10000);
  document.hidden = true;
  globalListeners.get("visibilitychange")();
  assert.equal(animation.cancelled, true);
  assert.equal(count, 2);
  assert.equal(element.scrollLeft, 1400);
  document.hidden = false;
  globalListeners.get("visibilitychange")();
  assert.equal(count, 3);
  motion.matches = true;
  globalListeners.get("motion")();
  assert.equal(animation.cancelled, true);
  assert.equal(count, 3);
  motion.matches = false;
  globalListeners.get("motion")();
  assert.equal(count, 4);
  listeners.get("focusin")();
  assert.equal(animation.cancelled, true);
  listeners.get("focusout")();
  timer();
  assert.equal(count, 5);
  animation.currentTime = 25001;
  cleanup();
  assert.equal(animation.cancelled, true);
  assert.ok(Math.abs(element.scrollLeft - 1000.04) < 0.001);
  assert.equal(disconnected, true);
  assert.equal(timer, undefined);
  assert.equal(listeners.size, 0);
  assert.equal(globalListeners.size, 0);
});
