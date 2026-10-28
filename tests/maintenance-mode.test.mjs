import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { NextRequest, NextResponse } from "next/server.js";
import ts from "typescript";
import { intl, loadLocaleModule } from "./helpers/i18n.mjs";

function loadProxy(maintenanceMode) {
  const source = ts.transpileModule(
    readFileSync(new URL("../proxy.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020
      }
    }
  ).outputText;
  let sessionChecks = 0;
  const context = {
    exports: {},
    process: { env: { MAINTENANCE_MODE: maintenanceMode } },
    Response,
    require(name) {
      if (name === "next-intl") return intl;
      if (name === "@/i18n/locale") return loadLocaleModule();
      if (name === "@/messages/en.json" || name === "@/messages/fr.json")
        return {
          __esModule: true,
          default: JSON.parse(readFileSync(name.replace("@/", ""), "utf8"))
        };
      if (name === "next/server") return { NextResponse };
      if (name === "@/utils/supabase/proxy") {
        return {
          updateSession: () => {
            sessionChecks += 1;
            return new Response("application");
          }
        };
      }
      throw new Error(`Unexpected import: ${name}`);
    }
  };
  vm.runInNewContext(source, context);
  return { proxy: context.exports.proxy, sessionChecks: () => sessionChecks };
}

test("le mode maintenance intercepte toutes les routes avant la session", async () => {
  for (const path of ["/", "/collection", "/api/private-action"]) {
    const loaded = loadProxy("true");
    const response = await loaded.proxy(
      new NextRequest(`http://localhost${path}`)
    );
    const html = await response.text();

    assert.equal(response.status, 503);
    assert.match(response.headers.get("content-type"), /^text\/html/);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    assert.match(html, /<html lang="en"/);
    assert.match(html, /Yokkai Collec' is undergoing maintenance/);
    assert.equal(loaded.sessionChecks(), 0);
  }
});

test("une valeur autre que true laisse fonctionner l'application", async () => {
  const loaded = loadProxy("false");
  const response = await loaded.proxy(
    new NextRequest("http://localhost/collection")
  );

  assert.equal(await response.text(), "application");
  assert.equal(loaded.sessionChecks(), 1);
});

test("seules les routes publiques de partage contournent le rafraîchissement de session", async () => {
  const id = "a".repeat(32);
  for (const path of [
    `/share/${id}`,
    ...["og", "story", "square"].map(format => `/share/${id}/image/${format}`)
  ]) {
    const loaded = loadProxy("false");
    const response = await loaded.proxy(
      new NextRequest(`http://localhost${path}`)
    );
    assert.equal(response.status, 200);
    assert.equal(loaded.sessionChecks(), 0, path);
  }
  for (const path of [
    "/collection",
    `/share/${id}x`,
    `/share/${id}/image/raw`,
    "/share/not-hex"
  ]) {
    const loaded = loadProxy("false");
    await loaded.proxy(new NextRequest(`http://localhost${path}`));
    assert.equal(loaded.sessionChecks(), 1, path);
  }
});
