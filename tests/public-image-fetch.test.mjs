import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import test from "node:test";
import {
  publicImageFetch,
  validateImageURL
} from "../lib/server/public-image-fetch.mjs";
import { downloadImage, retry } from "../scripts/import-cards.mjs";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function transport(
  addresses,
  { all = true, status = 200, compressed = false } = {}
) {
  const state = { resolutions: 0, connections: 0, requests: 0 };
  return {
    state,
    async lookup(hostname, options) {
      assert.equal(hostname, "images.example.com");
      assert.equal(options.all, true);
      state.resolutions++;
      // A second resolver invocation would return a rebinding address.
      return state.resolutions === 1
        ? addresses
        : [{ address: "127.0.0.1", family: 4 }];
    },
    request(url, options, receive) {
      state.requests++;
      assert.equal(url.hostname, "images.example.com");
      assert.equal(options.agent, false);
      assert.ok(options.signal instanceof AbortSignal);
      const req = new EventEmitter();
      req.end = () =>
        queueMicrotask(() =>
          options.lookup(url.hostname, { all }, (error, address, family) => {
            if (error) return req.emit("error", error);
            state.connections++;
            if (all) assert.deepEqual(address, addresses);
            else {
              assert.equal(address, addresses[0].address);
              assert.equal(family, addresses[0].family);
            }
            const body = compressed ? gzipSync(png) : png;
            const incoming = Readable.from([body]);
            incoming.statusCode = status;
            incoming.headers = {
              "content-type": "image/png",
              "content-length": String(body.length),
              ...(compressed ? { "content-encoding": "gzip" } : {}),
              ...(status === 302
                ? { location: "https://127.0.0.1/private" }
                : {})
            };
            receive(incoming);
          })
        );
      return req;
    }
  };
}

test("URL parsing blocks private, reserved and encoded IPs, credentials and HTTP", () => {
  for (const host of [
    "127.1",
    "2130706433",
    "0x7f000001",
    "0177.0.0.1",
    "10.1.2.3",
    "172.16.1.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "192.0.2.1",
    "[::1]",
    "[::ffff:127.0.0.1]",
    "[fc00::1]",
    "[fe80::1]",
    "[2001:db8::1]",
    "[2002:7f00:1::]"
  ]) {
    assert.throws(
      () => validateImageURL(`https://${host}/image`),
      /public/,
      host
    );
  }
  assert.throws(() => validateImageURL("http://example.com"), /HTTPS/);
  assert.throws(
    () => validateImageURL("https://user:password@example.com"),
    /Credentials/
  );
  for (const host of [
    "93.184.216.34",
    "[::ffff:93.184.216.34]",
    "[2606:4700::1111]"
  ]) {
    assert.ok(validateImageURL(`https://${host}/image`));
  }
});

test("DNS rejects every internal answer, mixed answers and empty answers before connecting", async () => {
  for (const addresses of [
    [],
    [{ address: "127.0.0.1", family: 4 }],
    [{ address: "::ffff:10.0.0.1", family: 6 }],
    [{ address: "fe80::1", family: 6 }],
    [
      { address: "93.184.216.34", family: 4 },
      { address: "192.168.0.1", family: 4 }
    ]
  ]) {
    const deps = transport(addresses);
    await assert.rejects(
      publicImageFetch(
        "https://images.example.com/image",
        {
          signal: AbortSignal.timeout(1000)
        },
        deps
      ),
      /public/
    );
    assert.equal(deps.state.connections, 0);
    assert.equal(deps.state.resolutions, 1);
  }
});

test("native HTTPS also refuses a private DNS result without opening a socket", async () => {
  let resolutions = 0;
  await assert.rejects(
    publicImageFetch(
      "https://images.example.com/image",
      {
        signal: AbortSignal.timeout(1000)
      },
      {
        lookup: async () => {
          resolutions++;
          return [{ address: "127.0.0.1", family: 4 }];
        }
      }
    ),
    /public/
  );
  assert.equal(resolutions, 1);
});

test("the socket receives checked public DNS addresses once and image decoding stays unchanged", async () => {
  for (const all of [true, false]) {
    const deps = transport(
      [
        { address: "93.184.216.34", family: 4 },
        { address: "2606:4700::1111", family: 6 }
      ],
      { all, compressed: true }
    );
    const image = await downloadImage(
      "https://images.example.com/image",
      (url, init) => publicImageFetch(url, init, deps)
    );
    assert.deepEqual(image.bytes, png);
    assert.equal(image.contentType, "image/png");
    assert.equal(deps.state.resolutions, 1);
    assert.equal(deps.state.connections, 1);
  }
});

test("redirects to internal URLs fail without a second request", async () => {
  const deps = transport([{ address: "93.184.216.34", family: 4 }], {
    status: 302
  });
  await assert.rejects(
    downloadImage("https://images.example.com/image", (url, init) =>
      publicImageFetch(url, init, deps)
    ),
    /HTTP 302/
  );
  assert.equal(deps.state.requests, 1);
  assert.equal(deps.state.connections, 1);
});

test("network failures retain fetch retries but DNS security refusals are permanent", async () => {
  let requests = 0;
  const request = () => {
    const req = new EventEmitter();
    req.end = () =>
      queueMicrotask(() => {
        requests++;
        req.emit(
          "error",
          Object.assign(new Error("network unavailable"), {
            code: "ECONNRESET"
          })
        );
      });
    return req;
  };
  await assert.rejects(
    retry(
      () =>
        publicImageFetch("https://images.example.com/image", {}, { request }),
      3,
      async () => {}
    ),
    /network unavailable/
  );
  assert.equal(requests, 3);
  const deps = transport([{ address: "127.0.0.1", family: 4 }]);
  await assert.rejects(
    retry(
      () =>
        downloadImage("https://images.example.com/image", (url, init) =>
          publicImageFetch(url, init, deps)
        ),
      3,
      async () => {}
    ),
    /public/
  );
  assert.equal(deps.state.requests, 1);
});
