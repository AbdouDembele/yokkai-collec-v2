import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { blockCrossSiteDEV } from "next/dist/server/lib/router-utils/block-cross-site-dev.js";

const source = readFileSync(
  new URL("../next.config.ts", import.meta.url),
  "utf8"
);
const exports = {};
vm.runInNewContext(
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText,
  {
    exports,
    URL,
    process: { env: {} },
    require: createRequire(import.meta.url)
  }
);
const config = exports.default;

test("development assets allow the specific LAN preview host without opening arbitrary origins", () => {
  const allowed = Array.from(config.allowedDevOrigins);
  assert.deepEqual(allowed, ["127.0.0.1", "192.168.100.20", "192.168.1.16"]);
  for (const path of ["/_next/static/chunks/main-app.js", "/_next/hmr"]) {
    for (const origin of [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://192.168.1.16:3000"
    ]) {
      const res = {
        statusCode: 200,
        end() {
          assert.fail("Allowed preview origin was blocked");
        }
      };
      assert.equal(
        blockCrossSiteDEV(
          { url: path, headers: { origin } },
          res,
          allowed,
          "localhost"
        ),
        false
      );
    }
    let ended = false;
    const res = {
      statusCode: 200,
      end() {
        ended = true;
      }
    };
    assert.equal(
      blockCrossSiteDEV(
        { url: path, headers: { origin: "https://untrusted.example" } },
        res,
        allowed,
        "localhost"
      ),
      true
    );
    assert.equal(res.statusCode, 403);
    assert.equal(ended, true);
  }
});
