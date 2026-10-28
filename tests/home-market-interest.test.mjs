import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

test("Home initial load and refresh request the same global-interest top six", async () => {
  const dashboard = readFileSync("components/home-dashboard.tsx", "utf8");
  const live = readFileSync("components/home-live.tsx", "utf8");
  assert.match(dashboard, /p_sort: "interest"/);
  assert.match(dashboard, /p_limit: 6/);
  const refresh = live.slice(live.indexOf("export function HomeMarket"));
  assert.match(refresh, /browseHomeAuctions\(\)/);
  assert.doesNotMatch(refresh, /sort: "end"/);
  const input = readFileSync("lib/data/market.ts", "utf8");
  const ast = ts.createSourceFile(
    "market.ts",
    input,
    ts.ScriptTarget.Latest,
    true
  );
  const fn = ast.statements.find(
    n => ts.isFunctionDeclaration(n) && n.name?.text === "browseHomeAuctions"
  );
  assert.ok(fn);
  const exports = {},
    calls = [];
  const items = [{ id: "popular-later" }, { id: "soon" }];
  vm.runInNewContext(
    ts.transpileModule(fn.getText(ast), {
      compilerOptions: { module: ts.ModuleKind.CommonJS }
    }).outputText,
    {
      exports,
      call: async (name, args) => {
        calls.push({ name, args });
        return { items, hasMore: true };
      },
      enrichAuctions: async (rows, sort) => {
        assert.equal(sort, false);
        return rows;
      }
    }
  );
  const page = await exports.browseHomeAuctions();
  assert.deepEqual(page.items, items);
  assert.equal(calls[0].name, "browse_auctions_page");
  assert.equal(calls[0].args.p_sort, "interest");
  assert.equal(calls[0].args.p_section, "active");
  assert.equal(calls[0].args.p_limit, 6);
});
