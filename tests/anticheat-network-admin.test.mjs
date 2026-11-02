import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the trusted route binds only Cloudflare HMAC identities to verified sessions", async () => {
  const [route, observer, layout] = await Promise.all([
    read("app/api/security/network-observation/route.ts"),
    read("components/network-security-observer.tsx"),
    read("app/layout.tsx")
  ]);
  assert.match(route, /request\.headers\.get\("x-yokkai-ip-hmac"\)/);
  assert.match(route, /client\.auth\.getUser\(\)/);
  assert.match(route, /SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(route, /record_anticheat_network_observation/);
  assert.doesNotMatch(route, /cf-connecting-ip|x-forwarded-for|x-real-ip/i);
  assert.doesNotMatch(route, /console\.(?:log|error)\([^)]*networkIdentity/);
  assert.match(observer, /method: "POST"/);
  assert.match(observer, /credentials: "same-origin"/);
  assert.match(layout, /<NetworkSecurityObserver \/>/);
});

test("network evidence remains contextual, short-lived and human-reviewed", async () => {
  const [migration, page, actions, docs, privacyEn, privacyFr] =
    await Promise.all([
      read("supabase/migrations/20261102010000_anticheat_network_review.sql"),
      read("app/admin/security/page.tsx"),
      read("app/admin/security/actions.ts"),
      read("docs/ANTICHEAT.md"),
      read("messages/en.json"),
      read("messages/fr.json")
    ]);
  assert.match(migration, /last_seen_at<stamp-interval '7 days'/);
  assert.match(migration, /to service_role/);
  assert.match(migration, /SHARED_NETWORK_IDENTITY/);
  assert.match(migration, /TRADE_SHARED_NETWORK_IDENTITY/);
  assert.match(migration, /create table public\.anticheat_case_reviews/);
  assert.match(migration, /prevent_anticheat_ledger_mutation/);
  assert.match(migration, /if not public\.is_current_user_admin\(\)/);
  assert.doesNotMatch(migration, /\b(?:ban|suspend|delete user)\b/i);
  assert.match(page, /networkLinkedAccounts/);
  assert.match(page, /reviewAnticheatCaseAction/);
  assert.match(actions, /requireAdminAction/);
  assert.match(docs, /aucune[\s\S]*sanction automatique/i);
  assert.match(
    JSON.parse(privacyEn).legalUi.antiCheatNetworkIdentity,
    /7 days/
  );
  assert.match(
    JSON.parse(privacyFr).legalUi.antiCheatNetworkIdentity,
    /7 jours/
  );
});
