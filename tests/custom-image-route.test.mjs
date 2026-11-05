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

const MB = 1024 * 1024;
const card = "c0000000-0000-4000-8000-000000000001";

function loadRoute({ player = "player-1", sizes = {}, rpcError } = {}) {
  const heads = [];
  const saves = [];
  const exports = {};
  vm.runInNewContext(transpile("app/api/collection/custom-image/route.ts"), {
    exports,
    Response,
    AbortSignal,
    Number,
    Set,
    process: { env: { SUPABASE_SECRET_KEY: "server-key" } },
    fetch: async (url, init) => {
      heads.push([url, init.method, init.redirect]);
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
                player
                  ? { data: { claims: { sub: player } }, error: null }
                  : { data: null, error: new Error("no session") }
            }
          })
        };
      if (name === "@/utils/supabase/config")
        return { getSupabaseConfig: () => ({ url: "https://api.test" }) };
      if (name === "@supabase/supabase-js")
        return {
          createClient: (url, key) => {
            assert.equal(key, "server-key");
            return {
              rpc: async (fn, args) => {
                saves.push([fn, args]);
                return rpcError
                  ? { data: null, error: { message: rpcError } }
                  : {
                      data: { instanceId: args.p_card_instance_id },
                      error: null
                    };
              }
            };
          }
        };
      if (name === "@/lib/ui/custom-image-media") return loadMedia();
      assert.fail(name);
    }
  });
  const post = body =>
    exports.POST(
      new Request("https://site.test/api/collection/custom-image", {
        method: "POST",
        body: JSON.stringify(body)
      })
    );
  return { post, heads, saves };
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
  assert.equal(CUSTOM_IMAGE_MAX_BYTES, 8 * MB);
});

test("the server saves custom art for the session player only after the 8 MB check", async () => {
  const { post, heads, saves } = loadRoute({
    sizes: {
      "https://i.imgur.com/Big.gif": 41 * MB,
      "https://i.imgur.com/Big.mp4": 2.5 * MB,
      "https://i.imgur.com/Still.gif": 9 * MB,
      "https://i.pinimg.com/originals/aa/heavy.gif": 9 * MB,
      "https://i.pinimg.com/originals/aa/light.jpg": 400 * 1024,
      "https://i.imgur.com/NoLength.jpg": null
    }
  });
  // 41 MB GIF whose MP4 weighs 2.5 MB: saved, for the session player.
  const big = await post({
    instanceId: card,
    url: "https://i.imgur.com/Big.gif"
  });
  assert.equal(big.status, 200);
  assert.equal((await big.json()).card.instanceId, card);
  const [fn, args] = saves.at(-1);
  assert.equal(fn, "set_card_custom_image_for_player");
  assert.deepEqual(JSON.parse(JSON.stringify(args)), {
    p_player: "player-1",
    p_card_instance_id: card,
    p_image_url: "https://i.imgur.com/Big.gif"
  });
  // Over 8 MB (a still GIF without MP4 counts as itself): refused, never saved.
  const before = saves.length;
  for (const url of [
    "https://i.imgur.com/Still.gif",
    "https://i.pinimg.com/originals/aa/heavy.gif"
  ]) {
    const response = await post({ instanceId: card, url });
    assert.equal(response.status, 413, url);
    assert.equal((await response.json()).error, "CUSTOM_IMAGE_TOO_LARGE");
  }
  assert.equal(saves.length, before);
  // Light, unknown size or unreachable: saved.
  for (const url of [
    "https://i.pinimg.com/originals/aa/light.jpg",
    "https://i.imgur.com/NoLength.jpg",
    "https://i.imgur.com/Missing.jpg"
  ])
    assert.equal((await post({ instanceId: card, url })).status, 200, url);
  // Removing the art needs no check and saves null.
  assert.equal((await post({ instanceId: card, url: null })).status, 200);
  assert.equal(saves.at(-1)[1].p_image_url, null);
  // Only HEAD requests, without following redirects.
  assert.ok(
    heads.every(
      ([, method, redirect]) => method === "HEAD" && redirect === "manual"
    )
  );
});

test("guests, foreign hosts and malformed requests never reach the database", async () => {
  const guest = loadRoute({ player: null });
  const refused = await guest.post({
    instanceId: card,
    url: "https://i.imgur.com/a.png"
  });
  assert.equal(refused.status, 401);
  assert.equal(guest.heads.length + guest.saves.length, 0);
  const player = loadRoute();
  for (const body of [
    { instanceId: card, url: "https://evil.test/a.png" },
    { instanceId: card, url: "http://i.imgur.com/a.png" },
    { instanceId: card, url: "https://i.imgur.com.evil.test/a.png" },
    { instanceId: card, url: "https://169.254.169.254/latest" },
    { instanceId: card, url: `https://i.imgur.com/${"a".repeat(2050)}.png` },
    { instanceId: card, url: 42 },
    { instanceId: "not-a-uuid", url: "https://i.imgur.com/a.png" },
    { url: "https://i.imgur.com/a.png" }
  ]) {
    const response = await player.post(body);
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 80));
  }
  assert.equal(player.heads.length + player.saves.length, 0);
});

test("database refusals come back as their stable codes", async () => {
  for (const code of ["PRO_REQUIRED", "CARD_NOT_OWNED", "ACCOUNT_BANNED"]) {
    const { post } = loadRoute({ rpcError: code });
    const response = await post({ instanceId: card, url: null });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, code);
  }
  const { post } = loadRoute({ rpcError: "something internal" });
  const response = await post({ instanceId: card, url: null });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, "CUSTOM_IMAGE_SAVE_FAILED");
});
