import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const read = file =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
function load(file) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(read(file), {
      compilerOptions: { module: ts.ModuleKind.CommonJS }
    }).outputText,
    { exports }
  );
  return exports;
}

test("ENG-02: admin player balances and last activity use US formats", () => {
  const source = read("app/admin/players/player-manager.tsx");
  const selected = {
    karasBalance: 1234567,
    lastSeenAt: "2026-10-18T12:34:00Z"
  };
  const expressions = source.match(
    /(?:selected\.karasBalance|player\.karasBalance|new Date\(selected\.lastSeenAt\))\.toLocaleString\("[^"]+"\)/g
  );
  assert.equal(expressions.length, 3);
  for (const expression of expressions) {
    const actual = vm.runInNewContext(expression, {
      selected,
      player: selected
    });
    assert.equal(
      actual,
      expression.startsWith("new Date")
        ? new Date(selected.lastSeenAt).toLocaleString("en-US")
        : "1,234,567"
    );
  }
});

test("ENG-02: report date is English and retains the Paris time zone", () => {
  const source = read("app/admin/reports/report-list.tsx");
  const formatter = source.match(
    /function reportDate\(value: string\) \{[\s\S]*?\n\}/
  )[0];
  const code = ts.transpileModule(formatter, {}).outputText;
  const actual = vm.runInNewContext(
    `${code}\nreportDate('2026-10-18T12:34:00Z')`
  );
  assert.equal(actual, "Oct 18, 2026, 2:34 PM");
});

test("ENG-02: US search preserves case folding and accent-sensitive matching", () => {
  const { cardSearchTerms, matchesCardSearch } = load("lib/ui/card-search.ts");
  assert.deepEqual(
    [...cardSearchTerms(" ÉCLAIR, BASHŌ (ONE PIECE) ")],
    ["éclair", "bashō", "one", "piece"]
  );
  for (const [query, values, expected] of [
    ["ÉCLAIR BASHŌ", ["Éclair", "Bashō"], true],
    ["eclair", ["Éclair"], false],
    ["basho", ["Bashō"], false],
    ["ICHIGO", ["Ichigo"], true],
    ["ichigo", ["İchigo"], false],
    ["佐藤", ["佐藤"], true]
  ])
    assert.equal(matchesCardSearch(query, values), expected, query);
  const sample = "ÉCLAIR BASHŌ I İ 佐藤";
  assert.equal(
    sample.toLocaleLowerCase("fr-FR"),
    sample.toLocaleLowerCase("en-US")
  );
});

test("ENG-02: multilingual proper names retain base sensitivity and numeric ordering", () => {
  const { sortCollection } = load("lib/ui/collection-sort.ts");
  const names = [
    "Zoro",
    "Éclair",
    "Eclair",
    "Bashō",
    "Basho",
    "Åke",
    "Özil",
    "İchigo",
    "ichigo",
    "佐藤",
    "孫悟空",
    "Naruto 10",
    "Naruto 2"
  ];
  const expected = [
    "Åke",
    "Bashō",
    "Basho",
    "Éclair",
    "Eclair",
    "İchigo",
    "ichigo",
    "Naruto 2",
    "Naruto 10",
    "Özil",
    "Zoro",
    "佐藤",
    "孫悟空"
  ];
  const cards = names.map((name, index) => ({
    name,
    instanceId: String(index).padStart(2, "0"),
    rarity: "C",
    shiny: false
  }));
  assert.deepEqual(
    Array.from(sortCollection(cards, "name"), card => card.name),
    expected
  );
  for (const locale of ["fr-FR", "en-US"]) {
    assert.deepEqual(
      names.toSorted((a, b) =>
        a.localeCompare(b, locale, { sensitivity: "base", numeric: true })
      ),
      expected
    );
  }
  assert.deepEqual(
    cards.map(card => card.name),
    names
  );
});
