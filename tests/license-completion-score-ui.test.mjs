import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
function render(locale, weighted) {
  const messages = JSON.parse(
    readFileSync("messages/" + locale + ".json", "utf8")
  );
  const t = createTranslator({
    locale,
    messages,
    namespace: "communityRanking"
  });
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync("components/global-license-stats.tsx", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX
        }
      }
    ).outputText,
    {
      exports,
      require: name => {
        if (name === "react/jsx-runtime") return jsx;
        if (name === "next-intl") return { useTranslations: () => t };
        throw Error(name);
      }
    }
  );
  return renderToStaticMarkup(
    jsx.jsx(exports.GlobalLicenseStats, {
      completionScore: weighted ? 30 : undefined,
      completed: 2,
      cards: 99,
      totalLicenses: 20,
      totalCards: 999
    })
  );
}
test("weighted UI presents completion score and completed-license count with EN/FR ICU text", () => {
  for (const locale of ["en", "fr"]) {
    const html = render(locale, true);
    assert.match(html, /data-global-stat="score"/);
    assert.match(html, /30 points/);
    assert.match(html, /2 \/ 20/);
    assert.doesNotMatch(html, /99 \/ 999|data-global-stat="cards"/);
    assert.match(
      html,
      locale === "fr" ? /Score de complétion/ : /Completion score/
    );
  }
});
test("legacy metric display remains compatible when no completion score is provided", () => {
  const html = render("en", false);
  assert.match(html, /data-global-stat="cards"/);
  assert.match(html, /99 \/ 999/);
  assert.doesNotMatch(html, /data-global-stat="score"/);
});
