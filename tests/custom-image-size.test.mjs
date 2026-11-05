import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const transpile = file =>
  ts.transpileModule(
    readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }
  ).outputText;

function loadMedia() {
  const exports = {};
  vm.runInNewContext(transpile("lib/ui/custom-image-media.ts"), { exports });
  return exports;
}

function loadRoute({ signedIn = true, sizes = {} } = {}) {
  const requested = [];
  const exports = {};
  vm.runInNewContext(
    transpile("app/api/collection/custom-image-size/route.ts"),
    {
      exports,
      Response,
      AbortSignal,
      Number,
      fetch: async (url, init) => {
        requested.push([url, init.method, init.redirect]);
        const size = sizes[url];
        if (size === undefined) return new Response(null, { status: 404 });
        return new Response(null, {
          status: 200,
          headers: size === null ? {} : { "content-length": String(size) }
        });
      },
      require: name => {
        if (name === "next/headers") return { cookies: async () => ({}) };
        if (name === "@/utils/supabase/server")
          return {
            createClient: () => ({
              auth: {
                getClaims: async () =>
                  signedIn
                    ? { data: { claims: { sub: "player" } }, error: null }
                    : { data: null, error: new Error("no session") }
              }
            })
          };
        if (name === "@/lib/ui/custom-image-media") return loadMedia();
        assert.fail(name);
      }
    }
  );
  const post = url =>
    exports.POST(
      new Request("https://site.test/api/collection/custom-image-size", {
        method: "POST",
        body: JSON.stringify({ url })
      })
    );
  return { post, requested };
}

test("Imgur GIFs play as their MP4, other art keeps its own file", () => {
  const { imgurGifVideo, CUSTOM_IMAGE_MAX_BYTES } = loadMedia();
  assert.equal(
    imgurGifVideo("https://i.imgur.com/AbC1.gif"),
    "https://i.imgur.com/AbC1.mp4"
  );
  for (const url of [
    "https://i.imgur.com/AbC1.png",
    "https://imgur.com/AbC1.gif",
    "https://i.pinimg.com/originals/aa/AbC1.gif",
    "https://i.imgur.com/a/b.gif",
    "https://i.imgur.com.evil.test/AbC1.gif",
    null
  ])
    assert.equal(imgurGifVideo(url), undefined, String(url));
  assert.equal(CUSTOM_IMAGE_MAX_BYTES, 8 * 1024 * 1024);
});

test("custom art over 8 MB is refused; the Imgur MP4 is what counts for GIFs", async () => {
  const MB = 1024 * 1024;
  const { post, requested } = loadRoute({
    sizes: {
      "https://i.imgur.com/Big.gif": 41 * MB,
      "https://i.imgur.com/Big.mp4": 2.5 * MB,
      "https://i.imgur.com/Still.gif": 9 * MB,
      "https://i.pinimg.com/originals/aa/heavy.gif": 9 * MB,
      "https://i.pinimg.com/originals/aa/light.jpg": 400 * 1024,
      "https://i.imgur.com/NoLength.jpg": null
    }
  });
  // 41 MB GIF whose MP4 weighs 2.5 MB: accepted.
  assert.equal((await post("https://i.imgur.com/Big.gif")).status, 200);
  // Still GIF without MP4 (Imgur answers 400/404): the GIF itself counts.
  const still = await post("https://i.imgur.com/Still.gif");
  assert.equal(still.status, 413);
  assert.equal((await still.json()).error, "CUSTOM_IMAGE_TOO_LARGE");
  assert.equal(
    (await post("https://i.pinimg.com/originals/aa/heavy.gif")).status,
    413
  );
  assert.equal(
    (await post("https://i.pinimg.com/originals/aa/light.jpg")).status,
    200
  );
  // Unknown size or unreachable file: never blocks the player.
  assert.equal((await post("https://i.imgur.com/NoLength.jpg")).status, 200);
  assert.equal((await post("https://i.imgur.com/Missing.jpg")).status, 200);
  // Only HEAD requests, without following redirects.
  assert.ok(
    requested.every(
      ([, method, redirect]) => method === "HEAD" && redirect === "manual"
    )
  );
});

test("only signed-in players and the allowed hosts can be checked", async () => {
  const guest = loadRoute({ signedIn: false });
  assert.equal((await guest.post("https://i.imgur.com/a.png")).status, 401);
  assert.equal(guest.requested.length, 0);
  const player = loadRoute();
  for (const url of [
    "https://evil.test/a.png",
    "http://i.imgur.com/a.png",
    "https://i.imgur.com.evil.test/a.png",
    "https://169.254.169.254/latest",
    `https://i.imgur.com/${"a".repeat(2050)}.png`,
    42
  ]) {
    const response = await player.post(url);
    assert.equal(response.status, 400, String(url).slice(0, 60));
  }
  assert.equal(player.requested.length, 0);
});
