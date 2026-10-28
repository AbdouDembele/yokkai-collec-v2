import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
test("prototype sounds: bounded voices, neutral hover, distinct C/R/SR and full cleanup", () => {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync("lib/ui/pack-sound.ts", "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }).outputText,
    { exports }
  );
  let allocations = 0;
  const param = () => ({
    value: 0,
    setValueAtTime(value) {
      this.value = value;
    },
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {}
  });
  const nodes = [],
    voices = [];
  const node = () => {
    const n = {
      gain: param(),
      frequency: param(),
      Q: param(),
      pan: param(),
      threshold: param(),
      knee: param(),
      ratio: param(),
      attack: param(),
      release: param(),
      connect(n) {
        return n;
      },
      disconnect() {
        this.disconnected = true;
      }
    };
    nodes.push(n);
    return n;
  };
  const source = () => {
    const n = Object.assign(node(), {
      start() {
        this.started = true;
      },
      stop(at) {
        this.endsAt = at;
        // Native onended is asynchronous; stopping must release nodes immediately.
      }
    });
    voices.push(n);
    return n;
  };
  const ctx = {
    currentTime: 0,
    sampleRate: 100,
    destination: {},
    createGain: node,
    createDynamicsCompressor: node,
    createBiquadFilter: node,
    createStereoPanner: node,
    createBufferSource: source,
    createOscillator() {
      const n = source();
      n.oscillator = true;
      return n;
    },
    createBuffer() {
      allocations++;
      return { getChannelData: () => new Float32Array(200) };
    }
  };
  for (const name of [
    "opening",
    "hover",
    "common",
    "rare",
    "sr",
    "ssr-reveal",
    "lr-reveal",
    "slide"
  ]) {
    const before = voices.length;
    const sound = exports.playPackSound(ctx, name);
    const active = voices.slice(before);
    assert.ok(
      active.length > 0 && active.length <= (name === "opening" ? 23 : 8)
    );
    assert.ok(active.every(n => n.started && n.endsAt > 0 && n.endsAt < 4));
    if (name === "hover")
      assert.ok(
        active.every(n => !n.oscillator),
        "hover is breath only"
      );
    if (["common", "rare", "sr", "ssr-reveal", "lr-reveal"].includes(name)) {
      const base = {
        common: 261.63,
        rare: 329.63,
        sr: 392,
        "ssr-reveal": 493.88,
        "lr-reveal": 659.25
      }[name];
      assert.equal(
        active.find(n => n.oscillator).frequency.value,
        base * 0.5,
        "each rarity keeps the same envelope with its own pitch"
      );
    }
    assert.equal(sound.active, true);
    sound.stop();
    assert.equal(sound.active, false);
    assert.ok(
      nodes.every(n => n.disconnected),
      "every source and processing node is released"
    );
  }
  assert.equal(allocations, 1, "noise is reused across openings");
});
