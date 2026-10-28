import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { intl, gameMessages } from "./helpers/i18n.mjs";

test("Settings offers an accessible, explicit complete-export support path without requesting secrets", () => {
  const require = createRequire(import.meta.url);
  const compiled = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(
        new URL("../components/data-export-form.tsx", import.meta.url),
        "utf8"
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX
        }
      }
    ).outputText,
    {
      module: compiled,
      exports: compiled.exports,
      require(id) {
        if (id === "next-intl") return { ...intl, useNow: () => new Date(0) };
        if (id === "@/i18n/game-messages") return gameMessages;
        if (id === "@/lib/ui/pack-countdown")
          return { packCountdown: () => "00:00:00" };
        if (id === "react")
          return {
            useState: value => [value, () => {}],
            useActionState: () => [{}, () => {}, false]
          };
        if (id === "react/jsx-runtime") return require(id);
        if (id === "@/components/ui")
          return { Button: props => React.createElement("button", props) };
        if (id === "@/app/settings/actions")
          return { reconnectForDeletion: () => {} };
        throw new Error("Unexpected dependency " + id);
      }
    }
  );
  const html = renderToStaticMarkup(
    React.createElement(compiled.exports.DataExportForm)
  );
  assert.match(
    html,
    /href="mailto:yokkaicollec@gmail\.com\?subject=Data%20export%20request"/
  );
  assert.match(html, />yokkaicollec@gmail\.com<\/a>/);
  assert.match(
    html,
    /from your account email address to request a complete export/
  );
  assert.match(html, /Never include your password or sign-in codes/);
  assert.match(html, /once every 24 hours/);
  assert.match(html, /Download my data/);
  assert.doesNotMatch(html, /type="password"|type="file"|target="_blank"/);
});
