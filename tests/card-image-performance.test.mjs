import { intl } from "./helpers/i18n.mjs";
import { createRequire } from "node:module";
import { cardRarityLabels } from "./helpers/card-rarity-labels.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

const catalogue =
  "https://images.example.test/storage/v1/object/public/card-images/card-a";
const source = readFileSync(
  new URL("../components/yokai-card.tsx", import.meta.url),
  "utf8"
);
function load(input = source) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(input, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true
      }
    }).outputText,
    {
      exports,
      URL,
      process: {
        env: { NEXT_PUBLIC_SUPABASE_URL: "https://images.example.test" }
      },
      require: name => {
        if (name === "next-intl") return intl;
        if (name === "@/lib/ui/card-rarity-label") return cardRarityLabels;
        if (name.endsWith(".css")) return {};
        if (name === "@/components/pro-access")
          return { useOwnProfileStyle: () => null };
        if (name === "react") return React;
        if (name === "react/jsx-runtime") return jsxRuntime;
        if (name === "next/image")
          assert.fail(
            "Card illustrations must load their original, not next/image"
          );
        assert.fail(name);
      }
    }
  );
  return exports.YokaiCard;
}

test("all grid sources and rarities load exactly the detail original, without resizing or recompression", () => {
  const YokaiCard = load();
  for (const image of [
    catalogue,
    "https://s4.anilist.co/file/anilistcdn/character/large/card.png",
    "https://i.imgur.com/card.png",
    "https://media.giphy.com/media/card/giphy.gif",
    "https://other.example.test/art.jpg",
    "/assets/booster-pack.png",
    `${catalogue}?token=private`
  ]) {
    for (const rarity of ["C", "R", "SR", "SSR", "LR"]) {
      const props = {
        name: "Card",
        category: "Test",
        rarity,
        image,
        animated: false
      };
      const detail = renderToStaticMarkup(
        React.createElement(YokaiCard, props)
      );
      for (const imageSizes of ["100vw", "(max-width: 640px) 45vw, 200px"]) {
        const grid = renderToStaticMarkup(
          React.createElement(YokaiCard, { ...props, imageSizes })
        );
        assert.equal(grid, detail, `${rarity} ${image}`);
        assert.doesNotMatch(
          grid,
          /_next\/image|data-optimized|srcSet=|sizes=|quality=/
        );
        assert.match(grid, /loading="lazy"/);
        assert.match(grid, /decoding="async"/);
        assert.ok(grid.includes(`src="${image}"`));
      }
    }
  }
});

test("personal image failure falls back to the native catalogue source and never loops", () => {
  const YokaiCard = load();
  let art;
  function visit(node) {
    if (!React.isValidElement(node)) return;
    if (node.props.onError) art = node;
    React.Children.forEach(node.props.children, visit);
  }
  visit(
    YokaiCard({
      name: "Card",
      category: "Test",
      rarity: "SR",
      image: "https://i.imgur.com/custom.png",
      catalogueImage: catalogue,
      imageSizes: "100vw"
    })
  );
  let replacements = 0;
  const target = {
    src: "https://i.imgur.com/custom.png",
    removeAttribute: () => {},
    set src(value) {
      this.current = value;
      replacements++;
    },
    get src() {
      return this.current;
    }
  };
  target.current = "https://i.imgur.com/custom.png";
  art.props.onError({ currentTarget: target });
  assert.equal(target.src, catalogue);
  art.props.onError({ currentTarget: target });
  assert.equal(replacements, 1);
});

test("optimizer remains restricted for other callers: exact public Storage origin, HTTPS, no redirects", () => {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL("../next.config.ts", import.meta.url), "utf8"),
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
        env: { NEXT_PUBLIC_SUPABASE_URL: "https://images.example.test" }
      }
    }
  );
  const images = exports.default.images;
  assert.equal(images.remotePatterns.length, 1);
  assert.equal(images.remotePatterns[0].hostname, "images.example.test");
  assert.equal(
    images.remotePatterns[0].pathname,
    "/storage/v1/object/public/card-images/**"
  );
  assert.equal(images.remotePatterns[0].search, "");
  assert.equal(images.maximumRedirects, 0);
  assert.notEqual(images.dangerouslyAllowLocalIP, true);
});

test("real transformations fail the rendered contract for grids and details, for every source", () => {
  for (const image of [
    catalogue,
    "https://s4.anilist.co/art.png",
    "https://i.imgur.com/art.png",
    "https://media.giphy.com/art.gif",
    "https://other.test/art.jpg"
  ]) {
    for (const imageSizes of [undefined, "100vw", "190px"]) {
      const props = {
        name: "Card",
        category: "Test",
        rarity: "C",
        image,
        imageSizes
      };
      for (const replacement of [
        'src: "/_next/image?url=" + encodeURIComponent(image ?? "") + "&w=128&q=75"',
        'src: (image ?? "") + "?width=128&quality=75"',
        'src: image ?? "", srcSet: (image ?? "") + "?width=128 128w", sizes: "100px"'
      ]) {
        const mutated = load(source.replace('src: image ?? ""', replacement));
        const html = renderToStaticMarkup(React.createElement(mutated, props));
        assert.throws(
          () => {
            assert.match(html, /<img\b/);
            assert.doesNotMatch(
              html,
              /_next\/image|srcSet=|sizes=|quality=|width=128/
            );
            assert.ok(html.includes('src="' + image + '"'));
          },
          undefined,
          image + " " + replacement
        );
      }
    }
  }
});

test("production grid and detail callers only select original image fields", () => {
  const names = [
    "collection",
    "profile",
    "community-views",
    "trades",
    "boosters"
  ];
  function originalObject(node) {
    return (
      ts.isIdentifier(node) ||
      (ts.isPropertyAccessExpression(node) && originalObject(node.expression))
    );
  }
  function originalExpression(node) {
    if (ts.isPropertyAccessExpression(node))
      return (
        originalObject(node.expression) &&
        ["image", "catalogueImage", "customImageUrl"].includes(node.name.text)
      );
    if (ts.isConditionalExpression(node))
      return (
        originalExpression(node.whenTrue) && originalExpression(node.whenFalse)
      );
    if (
      ts.isBinaryExpression(node) &&
      [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(
        node.operatorToken.kind
      )
    )
      return originalExpression(node.left) && originalExpression(node.right);
    return false;
  }
  for (const name of names) {
    const text = readFileSync(
      new URL("../components/" + name + ".tsx", import.meta.url),
      "utf8"
    );
    const ast = ts.createSourceFile(
      name + ".tsx",
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    let count = 0;
    function walk(node) {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        node.tagName.getText(ast) === "YokaiCard"
      ) {
        count++;
        for (const a of node.attributes.properties) {
          if (
            ts.isJsxAttribute(a) &&
            ["image", "fallbackImage", "catalogueImage"].includes(
              a.name.getText(ast)
            )
          ) {
            assert.ok(
              a.initializer &&
                ts.isJsxExpression(a.initializer) &&
                a.initializer.expression &&
                originalExpression(a.initializer.expression),
              name + ": transformed image at caller"
            );
          }
        }
      }
      ts.forEachChild(node, walk);
    }
    walk(ast);
    assert.ok(count > 0, name + ": grid/detail coverage missing");
  }
});
