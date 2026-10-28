import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { englishMessages } from "./helpers/i18n.mjs";
import { homePresentation } from "./helpers/home-presentation.mjs";

const read = path => readFileSync(path, "utf8");

test("Discord links use one internal redirect backed by a server-only setting", () => {
  const config = read("lib/discord-invite.ts");
  const route = read("app/discord/route.ts");
  const env = read(".env.example");

  assert.match(config, /process\.env\.DISCORD_INVITE_URL/);
  assert.doesNotMatch(config, /NEXT_PUBLIC_DISCORD/);
  assert.match(config, /discord\.gg/);
  assert.match(config, /discord\.com/);
  assert.match(config, /inviteUrl\.protocol === "https:"/);
  assert.match(route, /NextResponse\.redirect\(inviteUrl, 307\)/);
  assert.match(route, /status: 503/);
  assert.match(env, /^DISCORD_INVITE_URL=$/m);
});

test("the account menu and public footer expose the Discord invitation safely", () => {
  const account = read("components/account-menu.tsx");
  const presentation = homePresentation();
  const landing = presentation.footer;

  for (const source of [account, landing]) {
    assert.match(source, /href="\/discord"/);
    assert.match(source, /target="_blank"/);
    assert.match(source, /rel="noopener noreferrer"/);
    assert.match(source, /discordEnabled/);
  }
  assert.match(account, /t\("joinTheYokkaiDiscord"\)/);
  assert.equal(
    englishMessages.accountMenu.joinTheYokkaiDiscord,
    "Join the Yokkai Discord"
  );
  assert.match(
    landing,
    presentation.shared ? /t\("joinTheYokkaiDiscord"\)/ : /Join our Discord/
  );
  if (presentation.shared)
    assert.equal(
      englishMessages.siteFooter.joinTheYokkaiDiscord,
      "Join the Yokkai Discord"
    );
});

test("authenticated players get a dismissible one-time Discord promotion", () => {
  const promo = read("components/discord-promo.tsx");
  const layout = read("app/layout.tsx");

  assert.match(promo, /supabase\.auth\.getUser\(\)/);
  assert.match(promo, /yokkai-discord-promo-dismissed:/);
  assert.match(promo, /localStorage\.setItem/);
  assert.match(promo, /aria-label=\{t\("dismissDiscordInvitation"\)\}/);
  assert.equal(
    englishMessages.discordPromo.dismissDiscordInvitation,
    "Dismiss Discord invitation"
  );
  assert.match(promo, /t\("joinDiscord"\)/);
  assert.equal(englishMessages.discordPromo.joinDiscord, "Join Discord");
  assert.match(promo, /fixed right-4 bottom-4/);
  assert.match(promo, /max-sm:bottom-24/);
  assert.match(layout, /<DiscordPromo enabled=\{discordEnabled\} \/>/);
});
