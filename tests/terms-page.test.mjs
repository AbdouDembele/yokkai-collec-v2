import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { englishMessages } from "./helpers/i18n.mjs";

const terms = readFileSync("app/terms/page.tsx", "utf8");

test("terms are a public English information page linked from the shared footer", () => {
  assert.match(terms, /title: "Terms of Use/);
  assert.match(terms, /<PublicInfoPage/);
  assert.match(terms, /title="Terms of Use"/);
  assert.match(terms, /getDiscordInviteUrl\(\)/);
  assert.doesNotMatch(terms, /getCurrentUser|requireAuth|redirect\(/);
  assert.match(
    readFileSync("components/site-footer.tsx", "utf8"),
    /<Link href="\/terms">\{t\("termsOfUse"\)\}<\/Link>/
  );
  assert.equal(englishMessages.siteFooter.termsOfUse, "Terms of Use");
  for (const route of ["rules", "info", "rarities"]) {
    assert.match(terms, new RegExp(`href="/${route}"`));
  }
});

test("published terms identify the supplied publisher and effective date without preview notices", () => {
  assert.match(terms, /Publisher: Yokkai Collec/);
  assert.match(terms, /Effective date:/);
  assert.match(terms, /dateTime="2026-10-20"/);
  assert.match(terms, /robots: \{ index: true, follow: true \}/);
  assert.doesNotMatch(
    terms,
    /draft|not yet in effect|still pending|preview only/i
  );
  assert.equal((terms.match(/<InfoSection number=/g) ?? []).length, 10);
});

test("minors are not categorically excluded and mandatory consumer rights are preserved", () => {
  const text = terms.replace(/\s+/g, " ");
  assert.match(text, /Yokkai is not an adults-only service/);
  assert.match(text, /permission from a parent or legal guardian/);
  assert.match(
    text,
    /does not override any minimum age imposed by applicable law/
  );
  assert.doesNotMatch(text, /must be (?:at least )?18|18\+ only|adults only/i);
  assert.match(text, /Mandatory consumer rights remain unaffected/);
  assert.match(
    text,
    /express consent and acknowledgment must be obtained separately/
  );
  assert.doesNotMatch(
    text,
    /all (?:purchases|payments) are (?:final|non-refundable)/i
  );
});

test("the supplied contact is usable without invented legal or privacy details", () => {
  assert.match(terms, /href="mailto:yokkaicollec@gmail\.com"/);
  assert.match(terms, />\s*yokkaicollec@gmail\.com\s*</);
  assert.match(terms, /<Link href="\/privacy"/);
  assert.doesNotMatch(terms, /WikiMasters|wiki-masters\.com|CC-BY-SA/);
});

test("the terms use the dark navy background without recoloring other information pages", () => {
  const layout = readFileSync("components/public-info-page.tsx", "utf8");
  const css = readFileSync("styles/info-pages.css", "utf8");
  assert.match(terms, /tone="navy"/);
  assert.match(layout, /tone\?: "navy"/);
  assert.match(layout, /data-tone=\{tone\}/);
  assert.match(
    css,
    /\.yk-info-page\[data-tone="navy"\]\s*\{[^}]*--color-night:\s*#060913;[^}]*--color-surface:\s*#080d18;[^}]*background:\s*var\(--color-night\);/s
  );
});
