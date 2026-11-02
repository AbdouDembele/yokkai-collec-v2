import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export async function renderSanctionPage(locale = "en", mode = "active") {
  const id = "ac620000-0000-4000-8000-000000000001",
    other = "ac620000-0000-4000-8000-000000000002",
    copy = "ac620000-0000-4000-8000-000000000003";
  const recovery = {
    cards: 1,
    cardIds: [copy],
    blockedCards: 1,
    cardsNoLongerOnPrimary: 0,
    tradeKaras: 0,
    saleKaras: 0,
    saleCount: 0,
    karas: 0
  };
  const labels = {
    [copy]: { name: "BROLY", rarity: "LR", franchise: "Dragon Ball" }
  };
  const translations = JSON.parse(
    fs.readFileSync(`messages/${locale}.json`, "utf8")
  );
  const rpc = async name => ({
    error: null,
    data: {
      admin_list_anticheat_cases: {
        cases: [
          {
            userId: id,
            pseudo: "Example player",
            email: "fixture@example.invalid",
            score: 88,
            severity: "critical",
            status: "open",
            eventCount: 20,
            reasonCodes: ["SHARED_NETWORK_IDENTITY"],
            lastFlaggedAt: "2026-11-02T12:00:00Z",
            economicLinkedAccounts: 2,
            networkLinkedAccounts: 1
          }
        ],
        total: 1,
        summary: { open: 1, critical: 1, events24h: 3, flagged24h: 1 }
      },
      admin_list_anticheat_events: { events: [], total: 0 },
      admin_list_anticheat_connections: {
        [id]: {
          count: 1,
          accounts: [
            {
              userId: other,
              pseudo: "Related collector",
              lastSharedAt: "2026-11-02T12:00:00Z",
              sharedBrowser: false,
              acceptedTrades: 2,
              deleted: false
            }
          ]
        }
      },
      admin_list_smurf_sanction_candidates: [
        {
          userId: other,
          pseudo: "Primary collector",
          acceptedTrades: 1,
          lastTradeAt: "2026-11-02T12:00:00Z",
          sharedNetwork: false,
          sharedDevice: false
        }
      ],
      admin_preview_sanction:
        mode === "active"
          ? {
              smurf: { userId: id, pseudo: "Example player", banned: false },
              primary: {
                userId: other,
                pseudo: "Primary collector",
                karasBalance: 100
              },
              evidence: {
                sharedNetwork: false,
                sharedDevice: false,
                acceptedTrades: 1
              },
              recovery,
              eligible: true,
              alreadyApplied: false,
              cardLabels: labels,
              receipt: null,
              history: {
                trades: [
                  {
                    id,
                    fromUser: id,
                    toUser: other,
                    acceptedAt: "2026-11-02T12:00:00Z",
                    offeredCards: [copy],
                    requestedCards: [],
                    offeredKaras: 0,
                    requestedKaras: 0
                  }
                ],
                sales: []
              }
            }
          : {
              primary: {
                userId: id,
                pseudo: "Example player",
                karasBalance: 100
              },
              candidates: [
                {
                  id,
                  acceptedAt: "2026-11-02T12:00:00Z",
                  incomingCards: 1,
                  outgoingCards: 0,
                  incomingKaras: 0,
                  outgoingKaras: 0,
                  incomingNames: ["BROLY"],
                  outgoingNames: []
                }
              ],
              candidateCount: 1,
              selectedTradeIds: [id],
              selectionValid: true,
              eligible: true,
              recovery,
              cardLabels: labels,
              receipts: []
            }
    }[name]
  });
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} };
    vm.runInNewContext(
      ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
          target: ts.ScriptTarget.ES2022
        }
      }).outputText,
      {
        module: mod,
        exports: mod.exports,
        URLSearchParams,
        Intl,
        require(module) {
          if (module === "next-intl/server")
            return {
              getLocale: async () => locale,
              getTranslations: async namespace =>
                createTranslator({ locale, messages: translations, namespace })
            };
          if (module === "next/link")
            return {
              __esModule: true,
              default: ({ children, ...props }) =>
                React.createElement("a", props, children)
            };
          if (module === "next/headers") return { cookies: async () => ({}) };
          if (module === "@/lib/auth/admin")
            return { requireAdminPage: async () => ({ id: other }) };
          if (module === "@/lib/auth/session")
            return {
              getCurrentPseudo: async () => "Admin",
              getCurrentKarasBalance: async () => 100
            };
          if (module === "@/utils/supabase/server")
            return { createClient: () => ({ rpc }) };
          if (module === "./actions")
            return new Proxy(
              {},
              {
                get: () => () => {
                  throw Error("fixture must not submit");
                }
              }
            );
          if (module === "./deleted-smurf-recovery")
            return load("app/admin/security/deleted-smurf-recovery.tsx");
          if (module === "@/components/topbar")
            return { Topbar: () => React.createElement("div", null, "Yokkai") };
          if (module === "@/components/account-menu")
            return { AccountMenu: () => null };
          if (module === "../admin-navigation")
            return { AdminNavigation: () => null };
          if (module === "@/components/ui/url-pagination")
            return { UrlPagination: () => null };
          return require(module);
        }
      }
    );
    cache.set(file, mod.exports);
    return mod.exports;
  }
  async function resolve(node) {
    if (Array.isArray(node))
      return Promise.all(React.Children.toArray(node).map(resolve));
    if (!React.isValidElement(node)) return node;
    if (
      typeof node.type === "function" &&
      node.type.constructor.name === "AsyncFunction"
    )
      return resolve(await node.type(node.props));
    return React.cloneElement(node, {}, await resolve(node.props.children));
  }
  const page = await load("app/admin/security/page.tsx").default({
    searchParams: Promise.resolve({
      sanction: id,
      primary: other,
      mode,
      source: id
    })
  });
  return renderToStaticMarkup(await resolve(page));
}
test("unified sanction page shows one case action, named cards and named network counterparts in both locales", async () => {
  for (const locale of ["en", "fr"])
    for (const mode of ["active", "deleted"]) {
      const html = await renderSanctionPage(locale, mode);
      assert.doesNotMatch(
        html,
        /MISSING_MESSAGE|INVALID_MESSAGE|adminSecurity\./
      );
      assert.match(html, /Related collector/);
      assert.match(html, /BROLY/);
      assert.doesNotMatch(html, />ac620000-0000-4000-8000-000000000003</);
      assert.match(
        html,
        locale === "fr"
          ? /Navigateur commun non confirmé/
          : /Shared browser not confirmed/
      );
      assert.match(html, /name="confirmation"/);
      assert.doesNotMatch(html, /<button[^>]*disabled=""/);
    }
});
