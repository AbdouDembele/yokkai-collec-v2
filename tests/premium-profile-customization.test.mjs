import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHash } from "node:crypto";

test("Premium explains profile customization between the examples and comparison", () => {
  const source = readFileSync("components/premium-offer.tsx", "utf8");
  const examples = source.indexOf("<PremiumCardArtworkPreview />");
  const section = source.indexOf('className="yk-pro-profile-showcase"');
  const comparison = source.indexOf('id="plan-comparison"');
  assert.ok(examples >= 0 && section > examples && comparison > section);
  const profile = source.slice(section, comparison);
  assert.match(profile, /aria-labelledby="profile-customization-title"/);
  assert.match(profile, /id="profile-customization-title"/);
  assert.match(profile, /Your signature\./);
  assert.match(profile, /name font, colors and effects/);
  assert.match(profile, /avatar frame with decorative badges/);
  assert.match(profile, /profile theme/);
  assert.match(profile, /rules\.pro\.showcaseSlots/);
  assert.match(profile, /showcase\s+effects/);
  assert.doesNotMatch(profile, /background upload|card back|coming soon/i);
  assert.match(profile, /src="\/assets\/premium-examples\/bbdou-profile\.png"/);
  assert.match(
    profile,
    /alt="BBDOU's customized profile[^"]+ten-card showcase\./
  );
  assert.match(profile, /width=\{1920\}/);
  assert.match(profile, /height=\{1032\}/);
  assert.match(profile, /sizes="[^"]+"/);
});

test("the profile illustration is the supplied screenshot, not a fabricated preview", () => {
  const image = readFileSync(
    "public/assets/premium-examples/bbdou-profile.png"
  );
  assert.equal(image.subarray(1, 4).toString(), "PNG");
  assert.equal(image.readUInt32BE(16), 1920);
  assert.equal(image.readUInt32BE(20), 1032);
  assert.equal(
    createHash("sha256").update(image).digest("hex"),
    "2a69801d5259003352dfa700241969004830fe1dcb5a406c9c127f8b67f302eb"
  );
});

test("the profile presentation remains responsive and keeps the Premium palette", () => {
  const css = readFileSync("styles/premium.css", "utf8");
  const page = css.match(/\.yk-premium-page\s*\{([^}]+)\}/)?.[1];
  assert.match(page, /#080b10/);
  assert.doesNotMatch(page, /repeating-linear-gradient/);
  assert.match(
    css,
    /\.yk-pro-profile-heading h2 em\s*\{[^}]*var\(--plus-accent\)/
  );
  assert.match(
    css,
    /\.yk-pro-profile-photo-crop\s*\{[^}]*aspect-ratio: 1392 \/ 696;[^}]*overflow: hidden;/
  );
  assert.match(
    css,
    /@media \(max-width: 960px\)\s*\{\s*\.yk-pro-profile-showcase\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/
  );
  assert.match(
    css,
    /@media \(max-width: 600px\)\s*\{\s*\.yk-pro-profile-details\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/
  );
});
