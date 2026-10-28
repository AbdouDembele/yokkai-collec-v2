import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { intl } from "./helpers/i18n.mjs";
const require = createRequire(import.meta.url);
function setup() {
  let snapshot = {
      viewerId: "alice",
      messages: [{ friendId: "bob", count: 3 }],
      messageCount: 3,
      requestCount: 99
    },
    path = "/collection";
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync("components/floating-messenger.tsx", "utf8"),
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
      Intl,
      Map,
      require: name => {
        if (name === "react" || name === "react/jsx-runtime")
          return require(name);
        if (name === "next-intl") return intl;
        if (name === "next/navigation") return { usePathname: () => path };
        if (name === "@/hooks/use-social-unread")
          return { useSocialUnread: () => snapshot };
        if (name === "@/lib/data/conversations")
          return {
            getPrivateConversations: () => {
              throw Error("No inbox request until opened");
            }
          };
        return {};
      }
    }
  );
  return {
    Widget: exports.FloatingMessenger,
    setSnapshot: value => (snapshot = value),
    setPath: value => (path = value)
  };
}
test("floating message launcher counts messages rather than friend requests and opens as an accessible popup", () => {
  const { Widget } = setup();
  const html = renderToStaticMarkup(React.createElement(Widget));
  assert.match(html, /aria-label="Open messages"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, />\+3<\/span>/);
  assert.match(html, /3 unread messages/);
  assert.doesNotMatch(html, /\+99|yk-messenger-panel/);
});
test("identity changes remount the session and anonymous or auth pages expose no previous conversation", () => {
  const s = setup();
  assert.equal(s.Widget().key, "alice");
  s.setSnapshot({
    viewerId: "carol",
    messages: [],
    messageCount: 0,
    requestCount: 0
  });
  assert.equal(s.Widget().key, "carol");
  s.setSnapshot(undefined);
  assert.equal(s.Widget(), null);
  s.setSnapshot({
    viewerId: "alice",
    messages: [],
    messageCount: 0,
    requestCount: 0
  });
  for (const path of [
    "/login",
    "/signup",
    "/auth/callback",
    "/reset-password"
  ]) {
    s.setPath(path);
    assert.equal(s.Widget(), null);
  }
});
