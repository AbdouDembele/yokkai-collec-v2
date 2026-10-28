import { gameMessages } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createTranslator, createFormatter } from "next-intl";
test("pack availability is localized without changing the existing countdown", () => {
  for (const [locale, expected] of [
    ["en", "Available in 03:12:00"],
    ["fr", "Disponible dans 03:12:00"]
  ]) {
    const messages = JSON.parse(
      readFileSync(
        new URL(`../messages/${locale}.json`, import.meta.url),
        "utf8"
      )
    );
    const t = createTranslator({ locale, messages, namespace: "packs" });
    assert.equal(t("availableIn", { time: "03:12:00" }), expected);
  }
});

test("data error keys prefer stable codes and reject unknown provider text and prototype names", () => {
  assert.equal(
    gameMessages.gameErrorKey({ message: "PACK_NOT_READY" }),
    "cardErrors.packNotReady"
  );
  assert.equal(
    gameMessages.gameErrorKey({ message: "PRO_REQUIRED" }),
    "cardErrors.thisFeatureIsAvailableToProMembersOnly"
  );
  for (const value of [
    "__proto__",
    "constructor",
    "toString",
    "private provider diagnostic",
    { message: "__proto__" }
  ]) {
    assert.equal(
      gameMessages.gameErrorKey(value),
      "cardErrors.couldntReachGameDataPleaseTryAgainIn"
    );
  }
});

import ts from "typescript";
import vm from "node:vm";
const read = file =>
  readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const messages = Object.fromEntries(
  ["en", "fr"].map(locale => [
    locale,
    JSON.parse(read(`messages/${locale}.json`))
  ])
);

test("every static translation call in the PR 2 components resolves in both catalogues", () => {
  const files = [
    "boosters",
    "collection",
    "community-views",
    "game",
    "catalogue-card-modal",
    "collection-loading",
    "binder-favorite-review",
    "collection-filters",
    "ui/index",
    "ui/pagination",
    "card-sharing",
    "pro-access",
    "card-report-button",
    "booster-opening",
    "yokai-card"
  ];
  for (const file of files) {
    const source = read(`components/${file}.tsx`);
    const namespaces = Object.fromEntries(
      [
        ...source.matchAll(/const (\w+) = useTranslations\("([^"\n]*)"?\)/g)
      ].map(match => [match[1], match[2]])
    );
    for (const [name, namespace] of Object.entries(namespaces)) {
      for (const match of source.matchAll(
        new RegExp(`\\b${name}\\("([^"\n]+)"`, "g")
      )) {
        for (const locale of ["en", "fr"]) {
          const key = namespace ? `${namespace}.${match[1]}` : match[1];
          assert.equal(
            typeof key
              .split(".")
              .reduce((value, part) => value?.[part], messages[locale]),
            "string",
            `${locale}:${file}:${key}`
          );
        }
      }
    }
  }
});

test("English date display preserves its existing runtime timezone, instant and detail", () => {
  const source = ts.createSourceFile(
    "collection.tsx",
    read("components/collection.tsx"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let expression;
  const visit = node => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === "formatDate"
    )
      expression = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(expression);
  for (const zone of [
    "UTC",
    "Africa/Casablanca",
    "Europe/Paris",
    "America/New_York"
  ]) {
    const previous = process.env.TZ;
    process.env.TZ = zone;
    try {
      const formatDate = vm.runInNewContext(ts.transpile(`(${expression})`), {
        format: createFormatter({ locale: "en", timeZone: "UTC" }),
        Intl,
        Date
      });
      for (const instant of [
        "2026-10-24T23:59:00Z",
        "2026-03-29T00:30:00Z",
        "2026-10-25T01:30:00Z"
      ]) {
        for (const long of [false, true])
          assert.equal(
            formatDate(instant, long),
            new Date(instant).toLocaleDateString("en-US", {
              dateStyle: long ? "long" : "medium"
            }),
            `${zone}:${instant}:${long}`
          );
      }
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  }
  const en = createFormatter({ locale: "en" }),
    fr = createFormatter({ locale: "fr" });
  for (const n of [0, 1, 1000, 1234.567, 0.1])
    for (const options of [{}, { maximumFractionDigits: 2 }])
      assert.equal(en.number(n, options), n.toLocaleString("en-US", options));
  assert.equal(fr.number(1000).replace(/[\u202f\u00a0]/g, " "), "1 000");
});

test("evolution display describes five normal SSR or three normal LR copies as INFINITY", () => {
  const keys = [
    "evolveTarget",
    "evolutionRecipe",
    "evolutionResultLabel",
    "evolutionConfirmLabel",
    "evolutionVariant",
    "evolutionImageKept",
    "evolutionCustomCarry",
    "evolutionCombineSuffix"
  ];
  for (const locale of ["en", "fr"]) {
    const t = createTranslator({
      locale,
      messages: messages[locale],
      namespace: "collectionUi"
    });
    assert.match(t("ssrResult"), /SSR INFINITY/);
    assert.doesNotMatch(t("ssrResult"), /Shiny/);
    assert.equal(t("evolutionResultLabel", { rarity: "SSR" }), "1 ∞");
    assert.equal(t("evolutionResultLabel", { rarity: "LR" }), "1 ∞");
    assert.match(t("evolutionCustomCarry", { rarity: "SSR" }), /INFINITY/);
    assert.equal(t("evolutionPrefix", { rarity: "SSR" }), "∞ ");
    assert.equal(t("evolutionVariant", { rarity: "SSR" }), " INFINITY");
    for (const rarity of ["SSR", "LR"]) {
      for (const key of keys) {
        const label = t(key, { rarity, count: rarity === "SSR" ? 5 : 3 });
        assert.match(
          label,
          /INFINITY|∞|evolved|évoluée/,
          `${locale}:${rarity}:${key}`
        );
        assert.doesNotMatch(label, /Shiny/, `${locale}:${rarity}:${key}`);
      }
      assert.match(
        t("evolutionRecipe", { rarity, count: rarity === "SSR" ? 5 : 3 }),
        rarity === "SSR" ? /^5 / : /^3 /
      );
    }
  }
  assert.match(
    read("components/collection.tsx"),
    /const evolutionRequired = selected\?\.rarity === "LR" \? 3 : 5/
  );
});

test("catalogued English labels keep the exact copy covered by the presentation assertions", () => {
  const expected = {
    collectionUi: {
      offerATrade: "Offer a trade",
      thisCantBeUndone: "? This can't be undone.",
      evolutionProgress: "Evolution progress",
      confirmLrEvolution: "Confirm LR evolution",
      confirmSsrEvolution: "Confirm SSR evolution",
      lockCard: "Lock card",
      unlockCard: "Unlock card",
      cardLocked: "Card locked",
      lockedCards: "Locked cards",
      firstOwner: "First owner",
      chooseAFolder: "Choose a folder…",
      moving: "Moving…",
      move: "Move",
      suggested: "Suggested: ",
      useThisValue: "Use this value",
      cardListedForAuctionLockedUntilTheAuction:
        "Card listed for auction — locked until the auction ends",
      thisCardsCustomImageWillBeReset: "This card's custom image will be reset."
    },
    collectionShared: {
      destroying: "Destroying…",
      destroySelected: "Destroy selected"
    },
    catalogueUi: {
      rarity: "Rarity",
      category: "Category",
      currentOwners: "Current owners ",
      friends: "Friends",
      otherPlayers: "Other players",
      addToMyWishlist: "♡ Add to my wishlist",
      sortBy: "Sort by",
      remove: "♡ Remove"
    },
    packs: {
      listed: "LISTED",
      reveal5CardsAndChooseOneToKeep:
        "Reveal 5 cards and choose one to keep — with boosted drop rates.",
      openARegularPackAndAddAll5:
        "Open a Regular Pack and add all 5 cards to your collection."
    }
  };
  for (const [namespace, entries] of Object.entries(expected))
    for (const [key, value] of Object.entries(entries))
      assert.equal(messages.en[namespace][key], value, `${namespace}.${key}`);
});
