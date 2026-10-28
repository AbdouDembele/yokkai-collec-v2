import { intl, gameMessages, loadLocaleModule } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const testModule = { exports: {} };
  const js = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX
    }
  }).outputText;
  vm.runInNewContext(js, {
    module: testModule,
    exports: testModule.exports,
    require: name =>
      name in mocks
        ? mocks[name]
        : name === "next-intl"
          ? intl
          : name === "@/i18n/game-messages"
            ? gameMessages
            : name === "@/i18n/locale"
              ? loadLocaleModule()
              : require(name)
  });
  return testModule.exports;
}

// This test-only PR lands before the feature. Absence must be complete; once
// the catalogue ships, every picker and database assertion below is mandatory.
if (!existsSync("lib/ui/reaction-emojis.ts")) {
  test("reaction release has no orphaned picker or schema before its catalogue ships", () => {
    assert.equal(existsSync("components/emoji-reaction-picker.tsx"), false);
    assert.equal(
      existsSync("supabase/migrations/20261021020000_wall_emoji_reactions.sql"),
      false
    );
    assert.equal(
      existsSync(
        "supabase/migrations/20261021030000_home_wall_feed_and_eggplant.sql"
      ),
      false
    );
  });
} else {
  const catalog = load("lib/ui/reaction-emojis.ts");
  const eggplant = existsSync(
    "supabase/migrations/20261021030000_home_wall_feed_and_eggplant.sql"
  );
  const expectedCount = eggplant ? 25 : 24;
  function render(query = "", category = "All") {
    const states = [true, query, category];
    let index = 0;
    const { EmojiReactionPicker } = load(
      "components/emoji-reaction-picker.tsx",
      {
        react: { ...React, useState: () => [states[index++], () => {}] },
        "@/components/ui": {
          Modal: ({ children, title }) =>
            React.createElement("section", { "aria-label": title }, children)
        },
        "@/lib/ui/reaction-emojis": catalog
      }
    );
    return renderToStaticMarkup(
      React.createElement(EmojiReactionPicker, {
        disabled: false,
        selected: ["fire"],
        onSelect: () => {}
      })
    );
  }
  test("reaction catalogue and latest server whitelist match exactly and contain no duplicate IDs", () => {
    const ids = Array.from(catalog.REACTION_EMOJIS, item => item.id);
    assert.equal(ids.length, expectedCount);
    assert.equal(new Set(ids).size, ids.length);
    const sql = readdirSync("supabase/migrations")
      .filter(file => file.endsWith(".sql"))
      .sort()
      .map(file => readFileSync(`supabase/migrations/${file}`, "utf8"))
      .join("\n");
    const constraint = [
      ...sql.matchAll(/check\(emoji=any\(array\[([\s\S]*?)\]\)\)/g)
    ].at(-1);
    assert.ok(constraint, "A finite database whitelist is required");
    const checked = [...constraint[1].matchAll(/'([^']+)'/g)].map(
      match => match[1]
    );
    assert.deepEqual(checked.sort(), ids.sort());
    const setter = [...sql.matchAll(/p_emoji<>all\(array\[([\s\S]*?)\]\)/g)].at(
      -1
    );
    assert.ok(setter, "The RPC must validate the same finite whitelist");
    assert.deepEqual(
      [...setter[1].matchAll(/'([^']+)'/g)].map(match => match[1]).sort(),
      ids.sort()
    );
    assert.equal(catalog.reactionEmoji("unknown"), undefined);
    if (eggplant) assert.equal(catalog.reactionEmoji("eggplant").emoji, "🍆");
  });
  test("picker shows named emojis, selected state, category/search filtering and an empty result", () => {
    const html = render();
    assert.equal(
      (html.match(/aria-label="React with /g) ?? []).length,
      expectedCount
    );
    assert.match(html, /Search reactions/);
    assert.match(html, /aria-haspopup="dialog"/);
    assert.match(html, /aria-label="React with Fire" aria-pressed="true"/);
    assert.equal(
      (render("fire").match(/aria-label="React with /g) ?? []).length,
      1
    );
    assert.equal(
      (render("", "Faces").match(/aria-label="React with /g) ?? []).length,
      8
    );
    assert.match(render("no-such-emoji"), /No matching emojis/);
    if (eggplant) {
      assert.match(render("eggplant"), /aria-label="React with Eggplant"/);
      assert.equal(
        (render("eggplant").match(/aria-label="React with /g) ?? []).length,
        1
      );
    }
  });
}
