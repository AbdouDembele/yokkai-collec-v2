import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const files = {
  lr: "LR.mp3",
  ssr: "SSR.mp3"
};
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(mobile) {
  const refs = [],
    effects = [],
    media = [],
    fetched = [],
    voices = [],
    synthesized = [];
  let enabled = true,
    index = 0,
    closed = false;
  const exports = {};
  class Audio {
    constructor(src) {
      this.src = src;
      media.push(this);
    }
    play() {
      this.paused = false;
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
    removeAttribute() {}
    load() {}
  }
  class AudioContext {
    destination = {};
    resume() {
      return Promise.resolve();
    }
    suspend() {
      return Promise.resolve();
    }
    close() {
      closed = true;
      return Promise.resolve();
    }
    decodeAudioData(data) {
      return Promise.resolve(data);
    }
    createGain() {
      return { gain: {}, connect: node => node, disconnect() {} };
    }
    createBufferSource() {
      const voice = {
        connect: node => node,
        disconnect() {},
        start(when, offset) {
          this.started = true;
          this.offset = offset;
        },
        stop() {
          this.stopped = true;
          this.onended?.();
        }
      };
      voices.push(voice);
      return voice;
    }
  }
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../hooks/use-sfx.ts", import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022
        }
      }
    ).outputText,
    {
      exports,
      require: name =>
        name === "react"
          ? {
              useRef: initial => (refs[index++] ??= { current: initial }),
              useState: () => [
                enabled,
                value => {
                  enabled = value;
                }
              ],
              useCallback: fn => fn,
              useEffect: fn => effects.push(fn)
            }
          : name === "@/lib/ui/pack-sound"
            ? {
                playPackSound: (ctx, name) => {
                  const voice = {
                    name,
                    stopped: false,
                    stop() {
                      this.stopped = true;
                    },
                    get active() {
                      return !this.stopped;
                    }
                  };
                  synthesized.push(voice);
                  return voice;
                }
              }
            : require(name),
      window: {
        matchMedia: () => ({ matches: mobile }),
        localStorage: { getItem: () => null, setItem() {} },
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {}
      },
      navigator: {},
      Audio,
      AudioContext,
      CustomEvent: class {
        constructor(type, options) {
          this.detail = options.detail;
        }
      },
      fetch: async src => {
        fetched.push(src);
        return { arrayBuffer: async () => ({ src }) };
      }
    }
  );
  const render = () => {
    index = 0;
    return exports.useSfx();
  };
  const sound = render();
  const cleanup = effects.map(fn => fn()).filter(Boolean);
  return {
    sound,
    render,
    media,
    fetched,
    voices,
    synthesized,
    get closed() {
      return closed;
    },
    dispose: () => cleanup.forEach(fn => fn())
  };
}

test("provided MP3 cues work through media and mobile Web Audio, with no accumulating repeats", async () => {
  for (const mobile of [false, true]) {
    const h = harness(mobile);
    for (const name of Object.keys(files)) h.sound.play(name);
    await tick();
    assert.deepEqual(
      mobile ? h.fetched : h.media.map(audio => audio.src),
      Object.values(files).map(file => `/assets/sfx/${file}`)
    );
    h.sound.play("lr");
    await tick();
    if (mobile) {
      assert.equal(h.fetched.length, 2, "decoded files are cached");
      assert.equal(
        h.voices.filter(
          voice => voice.buffer.src.endsWith("LR.mp3") && !voice.stopped
        ).length,
        1
      );
    } else
      assert.equal(
        h.media.length,
        2,
        "repeat clicks restart the existing element"
      );
    h.sound.toggle();
    h.render().play("lr");
    await tick();
    assert.equal(mobile ? h.fetched.length : h.media.length, 2);
    assert.ok(
      mobile
        ? h.voices.every(voice => voice.stopped)
        : h.media.every(audio => audio.paused)
    );
    h.dispose();
    if (mobile) assert.equal(h.closed, true);
  }
});

test("a pending mobile decode cannot play after muting, advancing or leaving the pack screen", async () => {
  for (const action of ["mute", "stop", "dispose"]) {
    const h = harness(true);
    h.sound.play("lr");
    if (action === "mute") h.sound.toggle();
    else if (action === "stop") h.sound.stopCardSounds();
    else h.dispose();
    await tick();
    assert.equal(h.voices.length, 0);
  }
});

test("placing or revealing another card stops the previous reveal immediately on desktop and mobile", async () => {
  for (const mobile of [false, true]) {
    const h = harness(mobile);
    for (const name of ["lr", "ssr"]) {
      h.sound.play(name);
      await tick();
      const active = mobile
        ? h.voices
            .filter(voice => !voice.stopped)
            .map(voice => voice.buffer.src)
        : h.media.filter(audio => !audio.paused).map(audio => audio.src);
      assert.deepEqual(active, [`/assets/sfx/${files[name]}`]);
      const offset = name === "lr" ? 0.25 : name === "ssr" ? 0.18 : 0;
      assert.equal(
        mobile
          ? h.voices.at(-1).offset
          : h.media.find(audio => audio.src.endsWith(files[name])).currentTime,
        offset
      );
    }
    h.sound.stopCardSounds();
    assert.ok(
      mobile
        ? h.voices.every(voice => voice.stopped)
        : h.media.every(audio => audio.paused)
    );
    h.dispose();
  }
});

test("non-skippable LR/SSR MP3 bytes are unchanged and replaced WAV cues are removed", () => {
  for (const [name, hash] of Object.entries({
    "LR.mp3":
      "170fb50cc1ea6aa30c7b6e6cb83b0acdcee47b79f7cbf74c80b7ec621637bc6f",
    "SSR.mp3":
      "08bcdba9de60f2aea3cfa8a296bfefd7b7ae1c4b6c826e6f1b2a4c99e5512494"
  }))
    assert.equal(
      createHash("sha256")
        .update(
          readFileSync(new URL(`../public/assets/sfx/${name}`, import.meta.url))
        )
        .digest("hex"),
      hash
    );
  for (const name of ["flip", "slide", "ssr", "lr", "sr"])
    assert.equal(
      existsSync(new URL(`../public/assets/sfx/${name}.wav`, import.meta.url)),
      false
    );
});

test("five openings reuse one context and never accumulate prototype cues alongside retained LR/SSR audio", async () => {
  for (const mobile of [false, true]) {
    const h = harness(mobile);
    for (let i = 0; i < 5; i++) {
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
        h.sound.play(name);
        assert.equal(h.synthesized.at(-1).name, name);
        assert.equal(h.synthesized.filter(v => !v.stopped).length, 1);
      }
      h.sound.play("lr");
      await tick();
      assert.ok(h.synthesized.every(v => v.stopped));
      h.sound.play("common");
      h.sound.stopCardSounds();
      assert.ok(h.synthesized.every(v => v.stopped));
    }
    h.sound.play("opening");
    h.sound.toggle();
    assert.ok(h.synthesized.every(v => v.stopped));
    const count = h.synthesized.length;
    h.render().play("sr");
    assert.equal(h.synthesized.length, count);
    h.dispose();
    assert.equal(h.closed, true);
  }
});
test("retired generic cues cannot play underneath the new palette", () => {
  for (const file of [
    "clic.mp3",
    "reveal.mp3",
    "rumble.wav",
    "tear.wav",
    "shiny.wav",
    "flutter.wav"
  ])
    assert.equal(
      existsSync(new URL(`../public/assets/sfx/${file}`, import.meta.url)),
      false
    );
});
