import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import React from "react";
import ts from "typescript";
import { createTranslator, createFormatter } from "next-intl";
const require = createRequire(import.meta.url);
const source = readFileSync(
  new URL("../components/boosters.tsx", import.meta.url),
  "utf8"
);
function descendants(node) {
  return !node || typeof node !== "object"
    ? []
    : [
        node,
        ...React.Children.toArray(node.props?.children).flatMap(descendants)
      ];
}
for (const locale of ["en", "fr"])
  test(`Decision status labels use the ${locale} catalogue without changing card data`, () => {
    const messages = JSON.parse(
      readFileSync(
        new URL(`../messages/${locale}.json`, import.meta.url),
        "utf8"
      )
    );
    const context = {
      exports: {},
      process: { env: { NODE_ENV: "test" } },
      require: name => {
        if (name === "react")
          return {
            ...React,
            useState: value => [
              typeof value === "function" ? value() : value,
              () => {}
            ],
            useRef: value => ({ current: value }),
            useEffect() {},
            useCallback: fn => fn
          };
        if (name === "next-intl")
          return {
            useFormatter: () => createFormatter({ locale, timeZone: "UTC" }),
            useTranslations: namespace =>
              createTranslator({ locale, messages, namespace })
          };
        if (name === "next/dynamic") return { default: () => "Dynamic" };
        if (name === "next/link") return { default: "Link" };
        if (name === "@/lib/ui/card-rarity-label")
          return { cardRarityLabel: card => card.rarity };
        if (name === "@/components/ui")
          return {
            Button: "Button",
            Modal: "Modal",
            SelectionBar: "SelectionBar",
            SelectionModeButton: "SelectionModeButton",
            StatusPill: "StatusPill"
          };
        if (name === "@/components/yokai-card")
          return { YokaiCard: "YokaiCard", CardBack: "CardBack" };
        if (name.startsWith("@/")) return {};
        return require(name);
      }
    };
    vm.runInNewContext(
      ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX
        }
      }).outputText,
      context
    );
    const cards = Array.from({ length: 5 }, (_, i) => ({
      id: `card-${i}`,
      instanceId: `copy-${i}`,
      name: `Player card ${i}`,
      category: "ANIME/MANGA",
      anime: "Spirit Realm",
      rarity: "SR",
      image: "/card.png",
      discarded: i === 0
    }));
    const snapshot = JSON.stringify(cards);
    const tree = descendants(
      context.exports.BoosterReveal({
        cards,
        revealed: 5,
        onReveal() {
          assert.fail("render must not reveal");
        },
        onReturn() {},
        decision: {
          keptId: "copy-3",
          onKeep() {
            assert.fail("render must not keep");
          }
        }
      })
    );
    assert.deepEqual(
      tree
        .filter(n => n.props?.className === "yk-lost-stamp")
        .map(n => n.props.children),
      locale === "en"
        ? ["DESTROYED", "LOST", "LOST", "LOST"]
        : ["DÉTRUITE", "PERDUE", "PERDUE", "PERDUE"]
    );
    assert.deepEqual(
      tree.filter(n => n.type === "StatusPill").map(n => n.props.children),
      [locale === "en" ? "KEPT" : "GARDÉE"]
    );
    assert.equal(JSON.stringify(cards), snapshot);
    assert.deepEqual(
      tree.filter(n => n.type === "YokaiCard").map(n => n.props.name),
      cards.map(c => c.name)
    );
  });
