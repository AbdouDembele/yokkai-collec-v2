import test from "node:test";
import { assertAdminEmptyLicense } from "./helpers/optional-card-franchise.mjs";

for (const category of ["ANIME/MANGA", "ARTIST", "FILM"]) {
  test(`empty primary with secondary licenses keeps every binder for ${category}`, async t => {
    await assertAdminEmptyLicense(t, ["One Piece", "Naruto"], category);
  });
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

export function renderAdminCardEditor(
  primary = null,
  secondary = ["One Piece", "Naruto"]
) {
  const source = readFileSync("app/admin/cards/admin-card-manager.tsx", "utf8");
  const ast = ts.createSourceFile(
    "admin.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const functions = ast.statements
    .filter(
      node =>
        ts.isFunctionDeclaration(node) &&
        ["Feedback", "CategoryField", "LicenseFields", "CardRow"].includes(
          node.name?.text
        )
    )
    .map(node => node.getText(ast))
    .join("\n");
  const context = {
    exports: {},
    require: createRequire(import.meta.url),
    initialState: { ok: false, message: "" },
    NEW_CATEGORY: "__new_category__",
    useState: initial => [initial, () => {}],
    useActionState: (_action, initial) => [initial, () => {}, false],
    updateCardAction: async () => {},
    deleteCardAction: async () => {},
    Modal: () => null,
    Button: () => null
  };
  vm.runInNewContext(
    ts.transpileModule(`${functions}\nexports.CardRow=CardRow;`, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX
      }
    }).outputText,
    context
  );
  return renderToStaticMarkup(
    createElement(context.exports.CardRow, {
      card: {
        id: "10000000-0000-4000-8000-000000000001",
        nom: "Binder test card",
        categorie: "ARTIST",
        franchise: primary,
        franchises: secondary,
        rarete_base: "C",
        image_url: "https://example.test/card.png"
      },
      categories: ["ARTIST"]
    })
  );
}

test("reopening the editor keeps an empty primary before all secondary fields", () => {
  const values = html =>
    [...html.matchAll(/<input\b[^>]*>/g)]
      .filter(([input]) => input.includes('name="franchise"'))
      .map(([input]) => input.match(/value="([^"]*)"/)[1]);
  assert.deepEqual(values(renderAdminCardEditor()), [
    "",
    "One Piece",
    "Naruto"
  ]);
  assert.deepEqual(
    values(renderAdminCardEditor("One Piece", ["One Piece", "Naruto"])),
    ["One Piece", "Naruto"]
  );
});
