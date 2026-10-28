import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const routeFiles = [
  ["(auth)/connexion/page.tsx", "(auth)/login/page.tsx"],
  ["(auth)/inscription/page.tsx", "(auth)/signup/page.tsx"],
  ["(auth)/mot-de-passe-oublie/page.tsx", "(auth)/forgot-password/page.tsx"],
  ["amis/page.tsx", "friends/page.tsx"],
  ["compte-supprime/page.tsx", "account-deleted/page.tsx"],
  ["echanges/page.tsx", "trades/page.tsx"],
  ["marche/page.tsx", "market/page.tsx"],
  ["marche/[id]/page.tsx", "market/[id]/page.tsx"],
  ["parametres/page.tsx", "settings/page.tsx"],
  ["partage/[id]/page.tsx", "share/[id]/page.tsx"],
  [
    "partage/[id]/image/[format]/route.ts",
    "share/[id]/image/[format]/route.ts"
  ],
  ["profil/page.tsx", "profile/page.tsx"],
  ["profil/[id]/page.tsx", "profile/[id]/page.tsx"],
  ["recherche/page.tsx", "catalog/page.tsx"],
  ["reinitialiser-mot-de-passe/page.tsx", "reset-password/page.tsx"],
  ["succes/page.tsx", "achievements/page.tsx"]
];

test("the 16 English routes replace their old files without aliases", () => {
  for (const [oldPath, newPath] of routeFiles) {
    assert.equal(
      existsSync(new URL(`../app/${oldPath}`, import.meta.url)),
      false,
      oldPath
    );
    assert.equal(
      existsSync(new URL(`../app/${newPath}`, import.meta.url)),
      true,
      newPath
    );
  }
  for (const stable of [
    "admin/cards/page.tsx",
    "admin/players/page.tsx",
    "admin/reports/page.tsx",
    "design-system/catalogue-preview/page.tsx",
    "design-system/market-preview/enchere/page.tsx"
  ])
    assert.ok(existsSync(new URL(`../app/${stable}`, import.meta.url)), stable);
});

function load(file) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          esModuleInterop: true
        }
      }
    ).outputText,
    {
      exports,
      require: createRequire(import.meta.url),
      URL,
      process: {
        env: {
          NODE_ENV: "production",
          NEXT_PUBLIC_SITE_URL: "https://yokkai.example"
        }
      }
    }
  );
  return exports.default;
}

test("English sitemap and all shared pages/images retain noindex", async () => {
  assert.deepEqual(
    Array.from(load("app/sitemap.ts")(), entry => entry.url),
    [
      "https://yokkai.example/",
      "https://yokkai.example/login",
      "https://yokkai.example/signup",
      "https://yokkai.example/info",
      "https://yokkai.example/rules",
      "https://yokkai.example/rarities",
      "https://yokkai.example/premium",
      "https://yokkai.example/privacy",
      "https://yokkai.example/terms"
    ]
  );
  assert.ok(load("app/robots.ts")().rules.disallow.includes("/share/"));
  const headers = await load("next.config.ts").headers();
  const shared = headers.find(rule => rule.source === "/share/:path*");
  assert.ok(shared);
  assert.equal(
    shared.headers.find(header => header.key === "X-Robots-Tag")?.value,
    "noindex, nofollow"
  );
});
