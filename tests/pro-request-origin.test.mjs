import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const exports = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync("lib/pro/request-origin.ts", "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText,
  { exports, URL }
);
const { matchesProRequestOrigin } = exports;
const request = (target, origin, site = "same-origin") =>
  new Request(target + "/api/pro/profile-style", {
    headers: { ...(origin ? { origin } : {}), "sec-fetch-site": site }
  });

test("development accepts same-origin loopback aliases only on the configured protocol and port", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const origin = `http://${host}:3000`;
    assert.equal(
      matchesProRequestOrigin(
        request(origin, origin),
        "http://127.0.0.1:3000",
        true
      ),
      true
    );
  }
  for (const origin of [
    "http://localhost:3001",
    "https://localhost:3000",
    "https://evil.test",
    "http://localhost.evil.test:3000",
    "http://user@localhost:3000",
    "null"
  ])
    assert.equal(
      matchesProRequestOrigin(
        request("http://localhost:3000", origin),
        "http://127.0.0.1:3000",
        true
      ),
      false,
      origin
    );
  assert.equal(
    matchesProRequestOrigin(
      request("http://127.0.0.1:3000", "http://localhost:3000"),
      "http://127.0.0.1:3000",
      true
    ),
    false
  );
  assert.equal(
    matchesProRequestOrigin(
      request("http://localhost:3000", "http://localhost:3000", "cross-site"),
      "http://127.0.0.1:3000",
      true
    ),
    false
  );
  assert.equal(
    matchesProRequestOrigin(
      request("http://localhost:3000", null),
      "http://127.0.0.1:3000",
      true
    ),
    false
  );
  assert.equal(
    matchesProRequestOrigin(
      request("http://localhost:3000", "http://localhost:3000"),
      "https://yokkai-collec.com",
      true
    ),
    false
  );
});

test("production keeps an exact configured origin and rejects cross-site requests", () => {
  const origin = "https://yokkai-collec.com";
  assert.equal(
    matchesProRequestOrigin(request(origin, origin), origin, false),
    true
  );
  for (const other of [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://evil.test",
    null
  ])
    assert.equal(
      matchesProRequestOrigin(request(origin, other), origin, false),
      false
    );
  assert.equal(
    matchesProRequestOrigin(
      request(origin, origin, "cross-site"),
      origin,
      false
    ),
    false
  );
  assert.equal(
    matchesProRequestOrigin(
      request("http://localhost:3000", "http://localhost:3000"),
      "http://127.0.0.1:3000",
      false
    ),
    false
  );
});
