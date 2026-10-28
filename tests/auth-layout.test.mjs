import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("auth pages reuse the shared footer and configured Discord link", () => {
  const layout = readFileSync("app/(auth)/layout.tsx", "utf8");
  assert.match(
    layout,
    /import \{ SiteFooter \} from "@\/components\/site-footer"/
  );
  assert.match(layout, /<SiteFooter/);
  assert.match(layout, /discordEnabled=\{Boolean\(getDiscordInviteUrl\(\)\)\}/);
  assert.match(
    layout,
    /contactEmail=\{process\.env\.NEXT_PUBLIC_CONTACT_EMAIL\?\.trim\(\)\}/
  );
  assert.doesNotMatch(layout, /<footer/);
});

test("auth halos cannot extend scrolling past the footer or disable sticky positioning", () => {
  const css = readFileSync("styles/auth.css", "utf8");
  const shell = css.match(/\.yk-auth-shell\s*\{([^}]+)\}/)?.[1];
  assert.ok(shell);
  // clip bounds decorative overflow on both axes without creating a scroll container.
  assert.match(shell, /overflow:\s*clip\s*;/);
  assert.match(shell, /contain:\s*paint\s*;/);
  assert.match(shell, /background-image:\s*radial-gradient\(/);
  assert.doesNotMatch(css, /\.yk-auth-shell::(?:before|after)/);
  assert.match(shell, /min-height:\s*100dvh\s*;/);
  assert.doesNotMatch(shell, /(?:^|;)\s*height\s*:/);
  assert.match(css, /\.yk-auth-account\s*\{[^}]*position:\s*sticky\s*;/);
});

test("the auth footer keeps the page background continuous", () => {
  const css = readFileSync("styles/auth.css", "utf8");
  assert.match(
    css,
    /\.yk-auth-shell > \.yk-site-footer\s*\{[^}]*background:\s*transparent\s*;/
  );
});

test("auth entry never enlarges the page beyond the mobile viewport", () => {
  const css = readFileSync("styles/auth.css", "utf8");
  const transition = css.match(
    /\.yk-page-transition:has\(\.yk-auth-shell\)\s*\{([^}]+)\}/
  )?.[1];
  assert.ok(
    transition,
    "The auth transition must be scoped to its page wrapper"
  );
  assert.match(transition, /--page-enter-scale:\s*1\s*;/);
  assert.doesNotMatch(transition, /overflow(?:-x|-y)?:\s*hidden/);
});
