import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { intl } from "./helpers/i18n.mjs";

function load(file, require, globals = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          target: ts.ScriptTarget.ES2020
        }
      }
    ).outputText,
    {
      exports,
      require: name =>
        name === "next-intl"
          ? intl
          : name === "@/components/locale-controls"
            ? { LocaleSelector: () => null }
            : require(name),
      ...globals
    }
  );
  return exports;
}
test("badges hide zero and expose the exact English count while capping the visible total", () => {
  const { UnreadBadge } = load(
    "components/unread-badge.tsx",
    createRequire(import.meta.url)
  );
  assert.equal(
    renderToStaticMarkup(
      React.createElement(UnreadBadge, { count: 0, label: "unread messages" })
    ),
    ""
  );
  const one = renderToStaticMarkup(
    React.createElement(UnreadBadge, { count: 1, label: "unread messages" })
  );
  assert.match(one, /\+1/);
  assert.match(one, /1 unread messages/);
  const many = renderToStaticMarkup(
    React.createElement(UnreadBadge, {
      count: 1250,
      label: "unread messages and pending friend requests"
    })
  );
  assert.match(many, /99\+/);
  assert.match(many, /1,250 unread messages and pending friend requests/);
});

test("Friends uses a compact badge anchored above the left edge of its text without resizing Message badges", () => {
  const { UnreadBadge } = load(
    "components/unread-badge.tsx",
    createRequire(import.meta.url)
  );
  const compact = renderToStaticMarkup(
    React.createElement(UnreadBadge, {
      count: 1,
      label: "unread activity",
      variant: "nav"
    })
  );
  assert.match(compact, /class="yk-friends-nav-badge"/);
  assert.match(compact, /\+1/);
  const regular = renderToStaticMarkup(
    React.createElement(UnreadBadge, { count: 1, label: "unread message" })
  );
  assert.match(regular, /text-\[10px\]/);
  assert.doesNotMatch(regular, /yk-friends-nav-badge/);
  const css = readFileSync(
    new URL("../styles/topbar.css", import.meta.url),
    "utf8"
  );
  assert.match(css, /\.yk-friends-nav-label\s*\{[^}]*position:\s*relative/);
  assert.match(css, /\.yk-friends-nav-badge\s*\{[^}]*position:\s*absolute/);
  assert.match(
    css,
    /\.yk-friends-nav-badge\s*\{[^}]*right:\s*calc\(100% - 5px\)/
  );
  assert.match(
    css,
    /\.yk-friends-nav-badge\s*\{[^}]*bottom:\s*calc\(100% - 3px\)/
  );
  assert.match(css, /\.yk-friends-nav-badge\s*\{[^}]*font-size:\s*8px/);
});
test("recipient realtime subscription follows identity changes and cannot restart after cleanup", async () => {
  let onAuth,
    resets = 0,
    refreshes = 0,
    started = 0,
    stopped = 0,
    unsubscribed = 0;
  const api = load(
    "lib/data/social-unread.ts",
    name => {
      if (name === "@/utils/supabase/client")
        return {
          createClient: () => ({
            auth: {
              onAuthStateChange: callback => {
                onAuth = callback;
                return {
                  data: { subscription: { unsubscribe: () => unsubscribed++ } }
                };
              }
            }
          })
        };
      if (name === "@/lib/data/notifications")
        return {
          subscribeNotifications: () => {
            started++;
            return () => stopped++;
          }
        };
      return {};
    },
    { queueMicrotask }
  );
  const stop = api.liveSocialUnread.subscribe(
    () => refreshes++,
    () => resets++
  );
  onAuth("SIGNED_IN", { user: { id: "alice" } });
  await Promise.resolve();
  assert.equal(started, 1);
  assert.equal(resets, 1);
  assert.equal(refreshes, 1);
  onAuth("TOKEN_REFRESHED", { user: { id: "alice" } });
  await Promise.resolve();
  assert.equal(started, 1);
  assert.equal(resets, 1);
  onAuth("SIGNED_OUT", null);
  await Promise.resolve();
  assert.equal(stopped, 1);
  assert.equal(resets, 2);
  onAuth("SIGNED_IN", { user: { id: "bob" } });
  await Promise.resolve();
  assert.equal(started, 2);
  onAuth("SIGNED_IN", { user: { id: "carol" } });
  stop();
  await Promise.resolve();
  assert.equal(
    started,
    2,
    "Queued old account work cannot attach a channel after unmount"
  );
  assert.equal(unsubscribed, 1);
});
