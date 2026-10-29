import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import nextTesting from "next/experimental/testing/server.js";
const { unstable_doesMiddlewareMatch: unstable_doesProxyMatch } = nextTesting;

test("only public fonts/sounds bypass session and locale personalization; APIs keep Auth", () => {
  const { outputText } = ts.transpileModule(readFileSync("proxy.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
  });
  const context = { exports: {}, require: () => ({}), process: { env: {} } };
  vm.runInNewContext(outputText, context);
  const config = context.exports.config;
  for (const path of [
    "/fonts/profile/gothic-latin.woff2",
    "/fonts/Cinzel-Bold.ttf",
    "/assets/sfx/LR.mp3",
    "/assets/sfx/SSR.mp3"
  ]) {
    assert.equal(
      unstable_doesProxyMatch({ config, url: "https://example.test" + path }),
      false,
      path
    );
  }
  for (const path of [
    "/",
    "/catalog",
    "/collection",
    "/api/pro/benefits",
    "/api/pro/profile-style",
    "/api/profile-wall/media/private.woff2",
    "/api/auth/font.mp3",
    "/auth/callback",
    "/fonts/private",
    "/assets/sfx/private",
    "/design-system/fonts/a.woff2"
  ]) {
    assert.equal(
      unstable_doesProxyMatch({ config, url: "https://example.test" + path }),
      true,
      path
    );
  }
});
