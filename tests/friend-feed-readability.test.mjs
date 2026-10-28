import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const feed = readFileSync("styles/friend-feed.css", "utf8");
const interactions = readFileSync("styles/wall-interactions.css", "utf8");
const rule = (css, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  assert.ok(match, `Missing style rule: ${selector}`);
  return match[1];
};
const property = (body, name) => {
  const value = body.match(new RegExp(`(?:^|;)\\s*${name}:\\s*([^;]+)`))?.[1];
  assert.ok(value, `Missing property: ${name}`);
  return value.trim();
};
const luminance = hex => {
  assert.match(hex, /^#[\da-f]{6}$/i, "Use an opaque, measurable text surface");
  const channels = hex
    .slice(1)
    .match(/../g)
    .map(value => {
      const channel = parseInt(value, 16) / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
const readable = (foreground, background) => {
  const values = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a
  );
  const ratio = (values[0] + 0.05) / (values[1] + 0.05);
  assert.ok(ratio >= 4.5, `Text contrast is ${ratio.toFixed(2)}:1`);
};

test("feed post surfaces use the navigation's midnight-blue base", () => {
  const navigation = readFileSync("styles/topbar.css", "utf8");
  const channels = rule(navigation, ".yk-topbar").match(
    /rgba\((\d+),\s*(\d+),\s*(\d+),/
  );
  assert.ok(channels, "Navigation must define its base color");
  const base = `#${channels
    .slice(1, 4)
    .map(channel => Number(channel).toString(16).padStart(2, "0"))
    .join("")}`;
  assert.equal(property(rule(feed, ".yk-feed-post"), "background"), base);
});

test("feed posts have distinct surfaces, readable text and a bounded timeline", () => {
  const post = rule(feed, ".yk-feed-post");
  const background = property(post, "background");
  assert.match(post, /border:\s*1px solid/);
  assert.match(post, /border-radius:/);
  for (const selector of [
    ".yk-feed-text",
    ".yk-feed-author",
    ".yk-feed-post-content > header",
    ".yk-feed-wall-link"
  ]) {
    readable(property(rule(feed, selector), "color"), background);
  }
  assert.ok(
    parseFloat(property(rule(feed, ".yk-feed-text"), "font-size")) >= 16
  );
  const mobile = feed.slice(feed.indexOf("@media (max-width: 639px)"));
  assert.ok(
    parseFloat(property(rule(mobile, ".yk-feed-text"), "font-size")) >= 15
  );
  assert.match(rule(feed, ".yk-feed-timeline"), /max-height:\s*680px/);
});

test("post actions and emoji counts stay legible in default and selected states", () => {
  const action = rule(interactions, ".yk-post-actions > button");
  readable(property(action, "color"), property(action, "background"));
  assert.ok(parseFloat(property(action, "font-size")) >= 13);
  assert.ok(parseFloat(property(action, "min-height")) >= 40);
  assert.match(action, /border:\s*1px solid #[\da-f]{6}/i);
  assert.doesNotMatch(rule(interactions, ".yk-action-count"), /opacity:/);
  const chips = rule(interactions, ".yk-reaction-chips button");
  const count = rule(interactions, ".yk-reaction-chips strong");
  readable(property(count, "color"), property(chips, "background"));
  readable(
    property(count, "color"),
    property(
      rule(interactions, '.yk-reaction-chips button[aria-pressed="true"]'),
      "background"
    )
  );
});

test("reply text and timestamps retain contrast against their own bubble", () => {
  const bubble = property(
    rule(interactions, ".yk-post-reply > div"),
    "background"
  );
  readable(property(rule(interactions, ".yk-post-reply p"), "color"), bubble);
  readable(
    property(rule(interactions, ".yk-post-reply time"), "color"),
    bubble
  );
  assert.ok(
    parseFloat(property(rule(interactions, ".yk-post-reply p"), "font-size")) >=
      14
  );
});
