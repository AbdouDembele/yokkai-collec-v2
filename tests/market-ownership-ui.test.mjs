import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";

const require = createRequire(import.meta.url);
const source = readFileSync("components/community-views.tsx", "utf8");
const ast = ts.createSourceFile(
  "community-views.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const tile = ast.statements.find(
  node => ts.isFunctionDeclaration(node) && node.name?.text === "AuctionTile"
);
function render(count, locale) {
  const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule("export " + tile.getText(ast), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX
      }
    }).outputText,
    {
      exports,
      require,
      useTranslations: namespace =>
        createTranslator({ locale, messages, namespace }),
      useLocale: () => locale,
      useFormatter: () => ({
        number: n => new Intl.NumberFormat(locale).format(n)
      }),
      formatEndDate: () => "",
      urgencyClass: () => "",
      CardShell: ({ children }) => children,
      Link: ({ children, ...props }) =>
        React.createElement("a", props, children),
      YokaiCard: () => React.createElement("span", null, "Card"),
      Avatar: () => null,
      HourglassIcon: () => null,
      Karas: ({ amount }) => React.createElement("span", null, amount)
    }
  );
  return renderToStaticMarkup(
    React.createElement(exports.AuctionTile, {
      auction: {
        id: "listing",
        card: { name: "Card" },
        seller: "Seller",
        amount: 20,
        remaining: "01:00",
        remainingSeconds: 60,
        ownedCount: count
      }
    })
  );
}
test("market badges show owned copies in EN/FR and leave unknown or unowned cards unmarked", () => {
  for (const locale of ["en", "fr"]) {
    for (const count of [undefined, 0])
      assert.doesNotMatch(render(count, locale), /yk-market-owned/);
    for (const count of [1, 12]) {
      const html = render(count, locale);
      assert.match(html, /yk-market-owned/);
      assert.ok(
        html.includes(
          locale === "fr"
            ? `Déjà possédée · ${count}`
            : `Already owned · ${count}`
        )
      );
      assert.match(html, /href="\/market\/listing"/);
      assert.match(html, /Seller/);
    }
  }
});
