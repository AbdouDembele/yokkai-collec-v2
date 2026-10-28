import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { parse } from "@formatjs/icu-messageformat-parser";

function argumentsOf(message) {
  const args = new Set();
  function visit(nodes) {
    for (const node of nodes) {
      if ([1, 2, 3, 4, 5, 6, 8].includes(node.type))
        args.add(`${node.value}:${node.type}`);
      if (node.options)
        for (const option of Object.values(node.options)) visit(option.value);
      if (node.children) visit(node.children);
    }
  }
  visit(parse(message));
  return [...args].sort();
}

function flatten(messages, prefix = "") {
  return Object.fromEntries(
    Object.entries(messages).flatMap(([key, value]) => {
      const name = prefix ? `${prefix}.${key}` : key;
      if (typeof value !== "string")
        assert.ok(
          value !== null && typeof value === "object" && !Array.isArray(value),
          `${name} must be a string or message namespace`
        );
      return typeof value === "string"
        ? [[name, value]]
        : Object.entries(flatten(value, name));
    })
  );
}

test("English/French keys and ICU parameter types stay in parity", () => {
  const en = flatten(
    JSON.parse(readFileSync(new URL("../messages/en.json", import.meta.url)))
  );
  const fr = flatten(
    JSON.parse(readFileSync(new URL("../messages/fr.json", import.meta.url)))
  );
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const key in en)
    assert.deepEqual(argumentsOf(fr[key]), argumentsOf(en[key]), key);
  assert.throws(() => argumentsOf("{count, plural, one {one}}"));
  assert.notDeepEqual(argumentsOf("{name}"), argumentsOf("{otherName}"));
});

test("catalogues never translate rarity, currency or pack-name tokens", () => {
  const en = flatten(
    JSON.parse(readFileSync(new URL("../messages/en.json", import.meta.url)))
  );
  const fr = flatten(
    JSON.parse(readFileSync(new URL("../messages/fr.json", import.meta.url)))
  );
  const tokens = message =>
    (
      message.match(
        /\b(?:SSR|SR|LR|Shiny|INFINITY|Evolved|Karas|Regular Packs?|Decision Packs?)\b/g
      ) ?? []
    ).sort();
  for (const key in en) assert.deepEqual(tokens(fr[key]), tokens(en[key]), key);
});

const source = readFileSync(
  new URL("../i18n/locale.ts", import.meta.url),
  "utf8"
);
const context = { exports: {}, process: { env: {} } };
vm.runInNewContext(
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
  }).outputText,
  context
);
const { resolveLocale, parseLocaleCookie } = context.exports;

test("locale priority, exclusions, untrusted country and flag off", () => {
  const resolve = (options = {}) =>
    resolveLocale({ enabled: true, ...options }).locale;
  assert.equal(
    resolve({
      profile: "fr",
      cookie: "v1:manual:en:seen",
      acceptLanguage: "en"
    }),
    "fr"
  );
  assert.equal(
    resolve({ cookie: "v1:auto:fr:seen", acceptLanguage: "en" }),
    "fr"
  );
  assert.equal(
    resolve({
      acceptLanguage: "en-US,fr;q=0.5",
      country: "FR",
      trustedCountry: true
    }),
    "en"
  );
  assert.equal(resolve({ acceptLanguage: "en;q=0.2,fr-CA;q=0.9" }), "fr");
  assert.equal(
    resolve({ acceptLanguage: "de", country: "MA", trustedCountry: true }),
    "fr"
  );
  assert.equal(
    resolve({
      acceptLanguage: "fr;q=0,de",
      country: "FR",
      trustedCountry: true
    }),
    "en"
  );
  assert.equal(resolve({ country: "FR" }), "en");
  for (const country of ["CH", "CA", "XX", "T1"])
    assert.equal(resolve({ country, trustedCountry: true }), "en");
  assert.equal(
    resolve({
      enabled: false,
      profile: "fr",
      cookie: "v1:manual:fr:seen",
      acceptLanguage: "fr"
    }),
    "en"
  );
  assert.equal(parseLocaleCookie("v1:manual:xx:seen"), undefined);
  assert.equal(resolve({ cookie: "invalid", acceptLanguage: "fr" }), "fr");
  assert.equal(resolve({ acceptLanguage: "fr;q=oops,en;q=0.5" }), "en");
});

test("ambiguous GoTrue errors keep distinct keys, cooldown parameters and exact English copy", () => {
  const messages = JSON.parse(
    readFileSync(new URL("../messages/en.json", import.meta.url))
  );
  const context = {
    exports: {},
    require: () => ({ default: messages, __esModule: true })
  };
  const code = ts.transpileModule(
    readFileSync(new URL("../lib/auth/forms.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }
  ).outputText;
  vm.runInNewContext(code, context);
  const { authEmailError, authEmailErrorDescriptor } = context.exports;
  const cooldown = {
    code: "over_email_send_rate_limit",
    status: 429,
    message:
      "For security purposes, you can only request this after 60 seconds."
  };
  assert.equal(authEmailErrorDescriptor(cooldown).key, "emailCooldown");
  assert.equal(authEmailErrorDescriptor(cooldown).values.seconds, 60);
  assert.equal(
    authEmailError(cooldown),
    "Too many attempts. Wait a few minutes before trying again."
  );
  const budget = { ...cooldown, message: "Email rate limit exceeded" };
  assert.equal(authEmailErrorDescriptor(budget).key, "emailLimit");
  assert.equal(
    authEmailError(budget),
    "The service has reached its email sending limit. Try again later; this isn't an issue with your address."
  );
  assert.equal(
    authEmailErrorDescriptor({
      code: "unexpected_failure",
      status: 500,
      message: "Error sending recovery email"
    }).key,
    "emailUnavailable"
  );
  assert.equal(
    authEmailErrorDescriptor({
      code: "invalid_credentials",
      message: cooldown.message
    }).key,
    "invalidCredentials"
  );
});

test("French player copy follows the pack glossary and uses tutoiement", () => {
  const french = flatten(JSON.parse(readFileSync("messages/fr.json", "utf8")));
  for (const [key, text] of Object.entries(french))
    assert.doesNotMatch(text, /\b(?:vous|votre|vos|boosters?)\b/i, key);
});

test("explicit locale export keeps the original builder body and only adds locale", () => {
  const source = readFileSync(
    "supabase/migrations/20261019080000_referrals.sql",
    "utf8"
  ).replace(/\r\n/g, "\n");
  const migration = readFileSync(
    "supabase/migrations/20261027001000_profile_locale.sql",
    "utf8"
  ).replace(/\r\n/g, "\n");
  const original = source.match(
    /create or replace function public\.build_data_export\([\s\S]*?\$\$;/
  )[0];
  const explicit = migration.match(
    /create or replace function public\.build_data_export_without_wall_interactions\([\s\S]*?\$\$;/
  )[0];
  assert.equal(
    explicit
      .replace(
        "public.build_data_export_without_wall_interactions(",
        "public.build_data_export("
      )
      .replace("'locale',t.locale,", ""),
    original
  );
  assert.doesNotMatch(migration, /pg_get_functiondef|execute replace/);
});
