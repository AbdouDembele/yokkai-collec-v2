import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { intl, loadLocaleModule } from "./helpers/i18n.mjs";

const require = createRequire(import.meta.url);
function load(file, mocks) {
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
      name === "next-intl"
        ? intl
        : name === "@/i18n/locale"
          ? loadLocaleModule()
          : name in mocks
            ? mocks[name]
            : require(name)
  });
  return testModule.exports;
}
const data = load("lib/data/friend-feed.ts", {
  "@/utils/supabase/client": {},
  "@/lib/data/read-request": {}
});
const { HomeFriendFeed } = load("components/home-friend-feed.tsx", {
  "next/link": {
    default: ({ children, ...props }) =>
      React.createElement("a", props, children),
    __esModule: true
  },
  "@/components/ui": {
    Avatar: ({ name }) => React.createElement("span", null, name),
    Button: ({ children, variant: _variant, ...props }) => {
      void _variant;
      return React.createElement("button", props, children);
    }
  },
  "@/components/styled-player-name": {
    StyledPlayerName: ({ name }) => React.createElement("span", null, name)
  },
  "@/components/profile-wall": {
    ProfileWall: props =>
      React.createElement("div", {
        "data-wall-composer": props.composerOnly,
        "data-wall-owner": props.ownerId,
        "data-wall-name": props.pseudo
      })
  },
  "@/components/wall-post-interactions": {
    WallPostInteractions: ({ postId }) =>
      React.createElement("div", { "data-post-activity": postId })
  },
  "@/lib/data/friend-feed": data,
  "@/lib/data/profile-wall": { liveWall: {} },
  "@/lib/ui/public-post-link": { publicPostHref: () => "/social/everyone" },
  "@/styles/friend-feed.css": {}
});
const post = {
  id: "post-1",
  text: "<script>alert(1)</script>\nA new card",
  hasMedia: true,
  gifUrl: null,
  createdAt: "2026-10-20T18:00:00Z",
  author: { id: "friend-1", name: "Kitsune", avatarUrl: null }
};

test("feed renders existing posts safely and links directly to the author's Wall tab", () => {
  const html = renderToStaticMarkup(
    React.createElement(HomeFriendFeed, {
      initial: { items: [post], next: null }
    })
  );
  assert.match(html, /Friend feed/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /href="\/profile\/friend-1\?tab=wall"/);
  assert.match(html, /href="\/profile\?tab=wall"/);
  assert.match(html, /src="\/api\/profile-wall\/media\/post-1"/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /You&#x27;re all caught up/);
  assert.doesNotMatch(html, /Load older posts/);
  const profile = readFileSync("components/profile.tsx", "utf8");
  assert.match(profile, /searchParams.get\("tab"\) === "wall"/);
});

test("Home previews never expose deletion, including the signed-in player's posts", () => {
  const own = renderToStaticMarkup(
    React.createElement(HomeFriendFeed, {
      initial: { items: [post], next: null },
      viewer: post.author
    })
  );
  assert.doesNotMatch(own, /class="yk-feed-delete"/);
  assert.doesNotMatch(own, /Delete post/);
  const other = renderToStaticMarkup(
    React.createElement(HomeFriendFeed, {
      initial: { items: [post], next: null },
      viewer: { ...post.author, id: "someone-else" }
    })
  );
  assert.doesNotMatch(other, /Delete post/);
  assert.doesNotMatch(
    renderToStaticMarkup(
      React.createElement(HomeFriendFeed, {
        initial: { items: [post], next: null }
      })
    ),
    /Delete post/
  );
});

test("empty feed has a useful friend link; Home shows only the ten latest posts", () => {
  const empty = renderToStaticMarkup(
    React.createElement(HomeFriendFeed, { initial: { items: [], next: null } })
  );
  assert.match(empty, /Your timeline starts with your friends/);
  assert.match(empty, /href="\/friends"/);
  const html = renderToStaticMarkup(
    React.createElement(HomeFriendFeed, {
      initial: {
        items: Array.from({ length: 12 }, (_, index) => ({
          ...post,
          id: `post-${index + 1}`
        })),
        next: { at: post.createdAt, id: post.id }
      }
    })
  );
  assert.doesNotMatch(html, /Load older posts/);
  assert.equal((html.match(/data-feed-post=/g) ?? []).length, 10);
  assert.match(html, /data-feed-post="post-1"/);
  assert.match(html, /data-feed-post="post-10"/);
  assert.doesNotMatch(html, /data-feed-post="post-(?:11|12)"/);
  assert.match(html, /aria-label="Friends&#x27; wall posts"/);
  assert.match(
    readFileSync("styles/friend-feed.css", "utf8"),
    /max-height: 680px/
  );
  assert.equal(
    data.appendFeedPage([post], [post, { ...post, id: "post-2" }]).length,
    2
  );
});

test("initial server errors keep a named feed and access to the wall", () => {
  const html = renderToStaticMarkup(
    React.createElement(HomeFriendFeed, {
      initial: { items: [], next: null },
      initialError: "Couldn't load posts."
    })
  );
  assert.match(html, /Friend feed/);
  assert.match(html, /role="alert"/);
  assert.match(html, /href="\/profile\?tab=wall"/);
  assert.doesNotMatch(html, /aria-label="(?:Add post|Refresh feed)"/);
  assert.doesNotMatch(html, /Your timeline starts/);
});

test("Home embeds the existing own-wall composer even if the friend feed fails", () => {
  const html = renderToStaticMarkup(
    React.createElement(HomeFriendFeed, {
      initial: { items: [], next: null },
      initialError: "Couldn't load posts.",
      viewer: post.author
    })
  );
  assert.match(html, /data-wall-composer="true"/);
  assert.match(html, /data-wall-owner="friend-1"/);
  assert.match(html, /data-wall-name="Kitsune"/);
  assert.match(html, /Your profile visibility still applies/);
  assert.match(html, /role="alert"/);
});

test("Home omits add and refresh controls while keeping its composer hidden", () => {
  const html = renderToStaticMarkup(
    React.createElement(HomeFriendFeed, {
      initial: { items: [], next: null },
      viewer: post.author
    })
  );
  assert.doesNotMatch(html, /aria-label="(?:Add post|Refresh feed)"/);
  assert.doesNotMatch(html, /class="yk-feed-toolbar"/);
  assert.match(
    html,
    /id="home-feed-composer" class="yk-feed-composer" hidden=""/
  );
  assert.match(
    html,
    /id="home-feed-composer"[^>]*>[\s\S]*data-wall-composer="true"/
  );
});

test("wall previews put media before the excerpt and omit full interaction controls", () => {
  const html = renderToStaticMarkup(
    React.createElement(HomeFriendFeed, {
      initial: { items: [post], next: null }
    })
  );
  assert.ok(
    html.indexOf("yk-feed-media-preview") < html.indexOf("yk-feed-text")
  );
  assert.doesNotMatch(html, /data-post-activity=/);
  assert.match(html, /yk-feed-wall-link/);
  const css = readFileSync("styles/friend-feed.css", "utf8");
  const text = css.match(/\.yk-feed-text\s*\{([^}]+)\}/)[1];
  assert.match(text, /-webkit-line-clamp:\s*3/);
  assert.match(text, /overflow:\s*hidden/);
  assert.match(text, /text-overflow:\s*ellipsis/);
});

test("text-only wall previews never reserve a media placeholder", () => {
  const html = renderToStaticMarkup(
    React.createElement(HomeFriendFeed, {
      initial: {
        items: [{ ...post, hasMedia: false, gifUrl: null }],
        next: null
      }
    })
  );
  assert.match(html, /data-has-media="false"/);
  assert.doesNotMatch(html, /yk-feed-media-preview|yk-feed-no-media/);
  assert.match(html, /yk-feed-text/);
});
