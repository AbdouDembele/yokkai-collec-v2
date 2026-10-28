import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = file => readFileSync(file, "utf8");
const exports = {};
vm.runInNewContext(
  ts.transpileModule(read("lib/ui/booster-opening-document.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
  }).outputText,
  { exports, URL }
);

async function player({
  click = false,
  reduced = false,
  kind = "regular",
  delayed = false,
  pointer = false
} = {}) {
  const html = exports.boosterOpeningDocument(
    read("data/booster-opening/reveal.html"),
    "https://yokkai-collec.com",
    kind,
    click
  );
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(
    -1
  )[1];
  const frames = new Map(),
    transforms = {};
  const timers = new Map(),
    listeners = new Map(),
    messages = [];
  let now = 0,
    id = 0,
    replays = 0,
    cancelled = 0,
    loaded;
  const animation = {
    currentTime: 0,
    playbackRate: 1,
    cancel() {
      cancelled++;
    }
  };
  const parent = { postMessage: data => messages.push(data.type) };
  vm.runInNewContext(script, {
    parent,
    performance: { now: () => now },
    setTimeout(fn, ms) {
      timers.set(++id, { fn, at: now + ms });
      return id;
    },
    clearTimeout: key => timers.delete(key),
    requestAnimationFrame: fn => {
      frames.set(++id, fn);
      return id;
    },
    cancelAnimationFrame: key => frames.delete(key),
    document: {
      styleSheets: [],
      querySelector: selector => ({
        getBoundingClientRect: () => ({
          left: 100,
          top: 100,
          width: 200,
          height: 300
        }),
        style: {
          set transform(value) {
            transforms[selector] = value;
          }
        }
      }),
      getAnimations: () => [animation],
      addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: name => listeners.delete(name),
      documentElement: { classList: { add() {}, remove() {} } }
    },
    window: {
      addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: name => listeners.delete(name),
      matchMedia: query => ({
        matches: query.includes("pointer: fine") ? pointer : reduced
      }),
      setYokkaiBooster: () =>
        delayed
          ? new Promise(resolve => {
              loaded = resolve;
            })
          : Promise.resolve(true),
      replayYokkaiBooster: () => replays++
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  const send = (type, extra = {}) =>
    listeners.get("message")?.({
      source: parent,
      origin: "https://yokkai-collec.com",
      data: { type, ...extra }
    });
  return {
    animation,
    frames,
    transforms,
    move: point => send("yokkai-booster-pointer", { point }),
    settlePointer() {
      for (let i = 0; i < 100 && frames.size; i++) {
        now += 16;
        for (const [key, fn] of [...frames]) {
          frames.delete(key);
          fn(now);
        }
      }
    },
    timers,
    messages,
    listeners,
    get replays() {
      return replays;
    },
    get cancelled() {
      return cancelled;
    },
    open: () => send("yokkai-booster-open"),
    async ready() {
      loaded(true);
      await new Promise(resolve => setImmediate(resolve));
    },
    skip: () => send("yokkai-booster-next-step"),
    advance(ms) {
      const end = now + ms;
      for (const [key, timer] of timers) {
        if (timer.at > end) continue;
        now = timer.at;
        timers.delete(key);
        timer.fn();
      }
      now = end;
    },
    dispose: () => listeners.get("pagehide")()
  };
}

for (const click of [false, true])
  for (const kind of ["regular", "decision"]) {
    test(`${kind}, click=${click}: start, skip intro, accelerate cut, ignore spam, complete once`, async () => {
      const p = await player({ click, kind });
      if (click) {
        p.skip();
        assert.equal(p.timers.size, 0);
        p.open();
        p.open();
        assert.equal(p.replays, 1);
        assert.equal(p.animation.currentTime, 0, "starting is not a skip");
      }
      p.skip();
      assert.equal(p.animation.currentTime, 680);
      assert.equal(p.animation.playbackRate, 1);
      assert.equal(p.timers.size, 1);
      p.skip();
      assert.equal(p.animation.playbackRate, 3);
      const timer = [...p.timers.values()][0];
      for (let i = 0; i < 20; i++) p.skip();
      assert.equal([...p.timers.values()][0], timer);
      assert.equal(p.animation.currentTime, 680);
      assert.equal(p.messages.includes("YOKKAI_BOOSTER_COMPLETE"), false);
      p.advance(753);
      assert.equal(p.messages.includes("YOKKAI_BOOSTER_COMPLETE"), false);
      p.advance(1);
      p.skip();
      p.advance(10000);
      assert.equal(
        p.messages.filter(x => x === "YOKKAI_BOOSTER_COMPLETE").length,
        1
      );
    });
  }

test("one skip plays the entire cut; a first skip during the cut only accelerates its remainder", async () => {
  const p = await player();
  p.skip();
  p.advance(2259);
  assert.equal(p.messages.includes("YOKKAI_BOOSTER_COMPLETE"), false);
  p.advance(1);
  assert.equal(p.messages.at(-1), "YOKKAI_BOOSTER_COMPLETE");
  const q = await player();
  q.advance(1000);
  q.animation.currentTime = 1000;
  q.skip();
  assert.equal(q.animation.currentTime, 1000);
  assert.equal(q.animation.playbackRate, 3);
  q.advance(646);
  assert.equal(q.messages.includes("YOKKAI_BOOSTER_COMPLETE"), false);
  q.advance(1);
  assert.equal(q.messages.at(-1), "YOKKAI_BOOSTER_COMPLETE");
});

test("unmount cancels the active timer, animations and listeners at every stage", async () => {
  for (const skips of [0, 1, 2]) {
    const p = await player();
    for (let i = 0; i < skips; i++) p.skip();
    const stale = [...p.timers.values()][0].fn;
    p.dispose();
    stale();
    p.advance(10000);
    p.skip();
    assert.equal(p.timers.size, 0);
    assert.equal(p.cancelled, 1);
    assert.equal(p.listeners.has("message"), false);
    assert.equal(p.listeners.has("animationstart"), false);
    assert.equal(p.messages.includes("YOKKAI_BOOSTER_COMPLETE"), false);
  }
});

test("reduced motion retains the 500ms opening and ignores skip spam", async () => {
  for (const click of [false, true]) {
    const p = await player({ click, reduced: true });
    if (click) p.open();
    p.skip();
    p.skip();
    p.skip();
    assert.equal(p.animation.playbackRate, 1);
    p.advance(499);
    assert.equal(p.messages.includes("YOKKAI_BOOSTER_COMPLETE"), false);
    p.advance(1);
    assert.equal(p.messages.at(-1), "YOKKAI_BOOSTER_COMPLETE");
  }
});

test("early skip spam is bounded and replayed once on readiness; late loading cannot revive a disposed player", async () => {
  for (const click of [false, true]) {
    const p = await player({ click, delayed: true });
    if (click) p.open();
    for (let i = 0; i < 20; i++) p.skip();
    assert.equal(p.timers.size, 0);
    await p.ready();
    assert.equal(p.animation.currentTime, 680);
    assert.equal(p.animation.playbackRate, 3);
    assert.equal(p.timers.size, 1);
    p.advance(754);
    assert.equal(
      p.messages.filter(x => x === "YOKKAI_BOOSTER_COMPLETE").length,
      1
    );
  }
  const p = await player({ delayed: true });
  p.dispose();
  await p.ready();
  assert.equal(p.messages.length, 0);
  assert.equal(p.timers.size, 0);
});

test("the parent preserves two early skips without counting the initial gesture", () => {
  const source = read("components/boosters.tsx");
  const body = source.match(
    /const speedUpSeal = \(\) => \{([\s\S]*?)\n  \};/
  )[1];
  const messages = [];
  const frame = {
    dataset: { ready: "false" },
    contentWindow: { postMessage: data => messages.push(data.type) }
  };
  const stage = { current: { querySelector: () => frame } };
  const clicked = { current: false },
    pending = { current: 0 };
  const advance = new Function(
    "openingStage",
    "clickToOpen",
    "openingClicked",
    "setTearRequested",
    "pendingOpeningSkips",
    body
  );
  const skip = () => advance(stage, true, clicked, () => {}, pending);
  skip();
  assert.equal(pending.current, 0);
  for (let i = 0; i < 20; i++) skip();
  assert.equal(pending.current, 2);
  assert.deepEqual(messages, ["yokkai-booster-open"]);
});

test("only multi-click mousedown prevents selection; all generated pack images are non-draggable", () => {
  const source = read("components/boosters.tsx");
  const body = source.match(/onMouseDown=\{event => \{([\s\S]*?)\}\}/)[1];
  const down = new Function("event", body);
  for (const detail of [1, 2, 3, 20]) {
    let prevented = false;
    down({
      detail,
      preventDefault() {
        prevented = true;
      }
    });
    assert.equal(prevented, detail > 1);
  }
  const html = exports.boosterOpeningDocument(
    read("data/booster-opening/reveal.html"),
    "https://yokkai-collec.com",
    "regular"
  );
  assert(
    [...html.matchAll(/<img\b[^>]*>/g)].every(([tag]) =>
      tag.includes('draggable="false"')
    )
  );
  assert.match(read("components/booster-opening.tsx"), /draggable=\{false\}/);
});

test("after the actual cut ends, another click skips the remaining hold exactly once", async () => {
  for (const click of [false, true])
    for (const accelerated of [false, true]) {
      const p = await player({ click });
      if (click) p.open();
      p.skip();
      if (accelerated) p.skip();
      p.listeners.get("animationend")?.({ animationName: "pack-arrive" });
      assert.equal(p.messages.includes("YOKKAI_BOOSTER_COMPLETE"), false);
      p.listeners.get("animationend")?.({ animationName: "foil-body-open" });
      assert.equal(p.messages.includes("YOKKAI_BOOSTER_COMPLETE"), false);
      p.skip();
      assert.equal(p.messages.at(-1), "YOKKAI_BOOSTER_COMPLETE");
      p.skip();
      p.advance(10000);
      assert.equal(
        p.messages.filter(x => x === "YOKKAI_BOOSTER_COMPLETE").length,
        1
      );
      assert.equal(p.timers.size, 0);
    }
});

test("one persistent fan waits for a separate click and relays to individual reveals exactly once", async () => {
  for (const reduced of [false, true]) {
    const p = await player({ reduced });
    p.advance(reduced ? 500 : 2940);
    assert.equal(p.messages.at(-1), "YOKKAI_BOOSTER_COMPLETE");
    p.advance(60000);
    assert.equal(p.timers.size, 0);
    assert.equal(p.messages.includes("YOKKAI_BOOSTER_REVEAL"), false);
    p.skip();
    p.skip();
    assert.equal(
      p.messages.filter(m => m === "YOKKAI_BOOSTER_REVEAL").length,
      1
    );
    assert.equal(
      p.messages.filter(m => m === "YOKKAI_BOOSTER_COMPLETE").length,
      1
    );
    p.dispose();
  }
});
test("pack and existing fan sway together without selecting cards; reduced motion and unmount cancel the frame", async () => {
  const p = await player({ click: true, pointer: true });
  p.move({ x: 260, y: 260 });
  assert.equal(p.frames.size, 1);
  p.settlePointer();
  assert.match(p.transforms[".pack-position"], /rotateY\((?!0deg)/);
  p.open();
  assert.equal(p.frames.size, 0);
  p.advance(2940);
  p.move({ x: 260, y: 260 });
  p.settlePointer();
  assert.match(
    p.transforms[".opening-cards"],
    /^translate\(-50%,-50%\) translate3d/
  );
  assert.ok(p.messages.includes("YOKKAI_BOOSTER_HOVER"));
  p.move(null);
  p.settlePointer();
  assert.equal(p.frames.size, 0);
  p.move({ x: 260, y: 260 });
  p.dispose();
  assert.equal(p.frames.size, 0);
  const q = await player({ click: true, pointer: true, reduced: true });
  q.move({ x: 260, y: 260 });
  assert.equal(q.frames.size, 0);
  q.dispose();
});
