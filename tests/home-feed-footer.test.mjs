import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.createSourceFile(
  "home-friend-feed.tsx",
  readFileSync("components/home-friend-feed.tsx", "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
function withClass(node, name) {
  return (
    ts.isJsxElement(node) &&
    node.openingElement.attributes.properties.some(
      prop =>
        ts.isJsxAttribute(prop) &&
        prop.name.getText(source) === "className" &&
        prop.initializer &&
        ts.isStringLiteral(prop.initializer) &&
        prop.initializer.text === name
    )
  );
}
function find(node, predicate) {
  if (predicate(node)) return node;
  return ts.forEachChild(node, child => find(child, predicate));
}
const timeline = find(source, node => withClass(node, "yk-feed-timeline"));
const footer = find(source, node => withClass(node, "yk-feed-footer"));

test("feed has no explanatory footer or marketing signature", () => {
  assert.ok(timeline);
  assert.equal(footer, undefined);
  assert.doesNotMatch(
    source.getFullText(),
    /Your circle\. Your stories\.|Share\. React\. Connect\./
  );
});

test("latest-posts timeline has no pagination and keeps end-of-feed status after posts", () => {
  const more = find(timeline, node => withClass(node, "yk-feed-more"));
  const end = find(timeline, node => withClass(node, "yk-feed-end"));
  const post = find(timeline, node => withClass(node, "yk-feed-post"));
  assert.equal(more, undefined);
  assert.ok(end);
  assert.ok(post);
  assert.ok(end.pos > post.end);
  assert.doesNotMatch(source.getFullText(), /Load older posts/);
  assert.equal(footer, undefined);
});

test("the bounded timeline remains scrollable without a footer surface", () => {
  const css = readFileSync("styles/friend-feed.css", "utf8");
  const timelineRule = css.match(/\.yk-feed-timeline\s*\{([^}]+)\}/)?.[1];
  const footerRule = css.match(/\.yk-feed-footer\s*\{([^}]+)\}/)?.[1];
  assert.ok(timelineRule);
  assert.equal(footerRule, undefined);
  assert.match(timelineRule, /max-height:\s*680px/);
  assert.match(timelineRule, /overflow-y:\s*auto/);
  assert.match(timelineRule, /padding-bottom:\s*12px/);
  assert.doesNotMatch(css, /\.yk-feed-footer(?:-signature|-note)?\s*\{/);
});

test("posts form one horizontal row of uniform previews without internal scrolling", () => {
  const css = readFileSync("styles/friend-feed.css", "utf8");
  const strip = css.match(/\.yk-feed-timeline\s*\{([^}]+)\}/)[1];
  const post = css.match(/\.yk-feed-post\s*\{([^}]+)\}/)[1];
  assert.match(strip, /display:\s*flex/);
  assert.match(strip, /overflow-x:\s*auto/);
  assert.match(post, /flex:\s*0 0 min\(380px, 90%\)/);
  assert.match(post, /height:\s*390px/);
  assert.match(post, /overflow:\s*hidden/);
  assert.match(post, /overscroll-behavior-y:\s*contain/);
});
