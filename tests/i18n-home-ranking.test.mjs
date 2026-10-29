import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
async function render(locale, unavailable = false) {
  const calls = [];
  const data = {
    entries: [
      {
        userId: "me",
        pseudo: "Kitsune",
        position: 1,
        score: 1250,
        avatarUrl: null
      }
    ],
    mine: { isPublic: true, position: 1, score: 1250 },
    profileStyles: {
      me: { active: true, style: { avatarFrame: "bloodmoon" } }
    },
    rankedPlayers: 42
  };
  const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync("components/home-leaderboard.tsx", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX
        }
      }
    ).outputText,
    {
      exports,
      AbortSignal,
      require(name) {
        if (name === "react/jsx-runtime") return jsx;
        if (name === "next-intl/server")
          return {
            getTranslations: async namespace =>
              createTranslator({ locale, messages, namespace })
          };
        if (name === "next/headers") return { cookies: async () => ({}) };
        if (name === "next/link")
          return {
            default: ({ href, ...props }) =>
              React.createElement("a", { href, ...props })
          };
        if (name === "@/components/ui")
          return {
            Avatar: ({ name }) => React.createElement("span", null, name)
          };
        if (name === "@/components/styled-player-avatar")
          return {
            StyledPlayerAvatar: ({ name, cosmetics }) =>
              React.createElement(
                "span",
                {
                  "data-avatar-frame": cosmetics?.active
                    ? cosmetics.style.avatarFrame
                    : "none"
                },
                name
              )
          };
        if (name === "@/components/styled-player-name")
          return {
            StyledPlayerName: ({ name }) =>
              React.createElement("span", null, name)
          };
        if (name === "@/utils/supabase/server")
          return {
            createClient: () => ({
              rpc: (name, args) => {
                calls.push([name, args]);
                return {
                  abortSignal: async () => ({
                    data: unavailable ? null : data,
                    error: unavailable ? { message: "down" } : null
                  })
                };
              }
            })
          };
        if (name.endsWith(".css")) return {};
        throw Error(name);
      }
    }
  );
  const html = renderToStaticMarkup(
    await exports.HomeLeaderboard({ userId: "me" })
  );
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["get_collection_leaderboard", { p_offset: 0, p_limit: 6 }]
  ]);
  return html;
}
test("Home ranking keeps player data and exact English copy while translating its UI to tutoiement", async () => {
  const english = await render("en"),
    french = await render("fr");
  for (const text of ["Kitsune", "1,250", "Infinity", "Shiny"]) {
    assert.ok(english.includes(text));
    assert.ok(french.includes(text));
  }
  assert.match(english, /data-avatar-frame="bloodmoon"/);
  assert.match(french, /data-avatar-frame="bloodmoon"/);
  assert.match(english, /Your collection/);
  assert.match(english, /Rank #1 of 42/);
  assert.match(french, /Ta collection/);
  assert.match(french, /Rang n° 1 sur 42/);
  assert.doesNotMatch(
    french,
    /Your collection|Rare collections|More leading collectors/
  );
  assert.match(
    await render("fr", true),
    /Le classement est temporairement indisponible/
  );
});
