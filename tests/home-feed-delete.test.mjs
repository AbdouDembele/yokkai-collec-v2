import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { intl, gameMessages, loadLocaleModule } from "./helpers/i18n.mjs";
const require = createRequire(import.meta.url);

test("Home leaves deletion to the wall and never calls the removal adapter", async () => {
  const post = {
    id: "my-post",
    text: "A favorite",
    author: { id: "me", name: "Collector", avatarUrl: null },
    createdAt: "2026-10-21T10:00:00Z",
    hasMedia: true,
    gifUrl: null
  };
  const states = [],
    refs = [],
    buttons = [],
    effects = [],
    listeners = new Map();
  let stateIndex = 0,
    refIndex = 0,
    modal,
    calls = 0;
  const component = { exports: {} };
  const mocks = {
    "next-intl": intl,
    "@/i18n/locale": loadLocaleModule(),
    "@/i18n/game-messages": gameMessages,
    react: {
      ...React,
      useEffect: effect => effects.push(effect),
      useState: initial => {
        const i = stateIndex++;
        if (!(i in states)) states[i] = initial;
        return [
          states[i],
          value => {
            states[i] = typeof value === "function" ? value(states[i]) : value;
          }
        ];
      },
      useRef: initial => {
        const i = refIndex++;
        return (refs[i] ??= { current: initial });
      }
    },
    "next/link": {
      __esModule: true,
      default: ({ children, ...props }) =>
        React.createElement("a", props, children)
    },
    "@/components/ui": {
      Avatar: () => null,
      Button: ({ children, variant, ...props }) => {
        void variant;
        buttons.push({ children, ...props });
        return React.createElement("button", props, children);
      },
      Modal: props => {
        modal = props;
        return React.createElement("div", null, props.children);
      }
    },
    "@/components/styled-player-name": { StyledPlayerName: () => null },
    "@/components/profile-wall": { ProfileWall: () => null },
    "@/components/wall-post-interactions": { WallPostInteractions: () => null },
    "@/lib/data/profile-wall": { liveWall: {} },
    "@/lib/data/friend-feed": {},
    "@/styles/friend-feed.css": {}
  };
  const js = ts.transpileModule(
    readFileSync("components/home-friend-feed.tsx", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX
      }
    }
  ).outputText;
  const events = {
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name, handler) => {
      assert.equal(listeners.get(name), handler);
      listeners.delete(name);
    }
  };
  vm.runInNewContext(js, {
    Error,
    window: events,
    document: { ...events, visibilityState: "visible" },
    module: component,
    exports: component.exports,
    require: name => (name in mocks ? mocks[name] : require(name))
  });
  let resolveFeed, rejectFeed;
  const adapter = {
    remove: async () => {
      calls++;
    },
    discard: async () => {
      calls++;
    }
  };
  const load = () =>
    new Promise((resolve, reject) => {
      resolveFeed = resolve;
      rejectFeed = reject;
    });
  const render = () => {
    stateIndex = 0;
    refIndex = 0;
    buttons.length = 0;
    modal = null;
    return renderToStaticMarkup(
      React.createElement(component.exports.HomeFriendFeed, {
        initial: { items: [post], next: null },
        viewer: post.author,
        wallAdapter: adapter,
        load
      })
    );
  };
  const html = render();
  const unsubscribe = effects[1]();
  assert.equal(modal, null);
  assert.doesNotMatch(html, /Delete post|yk-feed-delete/);
  assert.match(html, /data-feed-post="my-post"/);
  assert.match(html, /View wall/);
  assert.equal(calls, 0, "home previews never request deletion");
  assert.equal(
    buttons.some(button => button["aria-label"] === "Refresh feed"),
    false,
    "Home refreshes on focus without a manual refresh control"
  );
  listeners.get("focus")();
  const pending = render();
  assert.match(pending, /data-feed-post="my-post"/);
  assert.doesNotMatch(pending, /Loading your timeline/);
  resolveFeed({ items: [{ ...post, id: "updated-post" }], next: null });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(render(), /data-feed-post="updated-post"/);
  listeners.get("player-block-changed")();
  assert.doesNotMatch(render(), /data-feed-post=/);
  resolveFeed({ items: [post], next: null });
  await new Promise(resolve => setImmediate(resolve));
  render();
  listeners.get("focus")();
  rejectFeed(Error("Access changed"));
  await new Promise(resolve => setImmediate(resolve));
  assert.doesNotMatch(render(), /data-feed-post=/);
  assert.match(render(), /Couldn&#x27;t refresh your feed/);
  assert.equal(calls, 0, "refreshes never request deletion");
  unsubscribe();
  assert.equal(listeners.size, 0);
});
