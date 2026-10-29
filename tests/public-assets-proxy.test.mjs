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

test("public asset cache headers retain global security headers and never apply to API/media responses", async () => {
  const context = {
    exports: {},
    URL,
    process: {
      env: {
        NODE_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: "https://api.example.test",
        NEXT_PUBLIC_SITE_URL: "https://example.test",
        CSP_ENFORCE: "true"
      }
    },
    require: name => {
      assert.equal(name, "next-intl/plugin");
      return () => config => config;
    }
  };
  vm.runInNewContext(
    ts.transpileModule(readFileSync("next.config.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true }
    }).outputText,
    context
  );
  for (const path of [
    "/fonts/profile/gothic-latin.woff2",
    "/assets/sfx/LR.mp3"
  ]) {
    const response = await nextTesting.unstable_getResponseFromNextConfig({
      url: "https://example.test" + path,
      nextConfig: context.exports.default
    });
    assert.equal(response.headers.get("cache-control"), "public, max-age=3600");
    assert.match(
      response.headers.get("content-security-policy"),
      /frame-ancestors 'none'/
    );
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  }
  for (const path of [
    "/api/pro/benefits",
    "/api/profile-wall/media/private.woff2",
    "/auth/callback",
    "/profile/player"
  ]) {
    const response = await nextTesting.unstable_getResponseFromNextConfig({
      url: "https://example.test" + path,
      nextConfig: context.exports.default
    });
    assert.equal(
      response.headers.get("cache-control"),
      null,
      "No public cache override outside public files"
    );
    assert.match(
      response.headers.get("content-security-policy"),
      /frame-ancestors 'none'/
    );
  }
});
