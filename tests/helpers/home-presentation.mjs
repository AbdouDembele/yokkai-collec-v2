import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(path, "utf8");

// Preserve the existing public-header/footer checks during the approved switch
// from the standalone landing page to the shared signup experience.
export function homePresentation() {
  const home = read("app/page.tsx");
  if (!home.includes("<AuthLayout>")) {
    return {
      shared: false,
      header: home,
      footer: home,
      css: read("styles/landing.css"),
      brandImageClass: "yk-landing-brand-image"
    };
  }

  assert.match(home, /import AuthLayout from "\.\/\(auth\)\/layout"/);
  assert.match(home, /import SignUpPage from "\.\/\(auth\)\/signup\/page"/);
  assert.match(
    home,
    /<AuthLayout>\s*<SignUpPage searchParams=\{searchParams\} \/>\s*<\/AuthLayout>/
  );
  assert.doesNotMatch(home, /yk-landing-hero/);
  const layout = read("app/(auth)/layout.tsx");
  assert.match(
    layout,
    /if \(await getCurrentUser\(\)\) redirect\("\/boosters"\)/
  );
  assert.match(
    layout,
    /import \{ SiteFooter \} from "@\/components\/site-footer"/
  );
  assert.match(layout, /<SiteFooter/);
  assert.match(layout, /discordEnabled=\{Boolean\(getDiscordInviteUrl\(\)\)\}/);
  return {
    shared: true,
    header: layout,
    footer: layout + read("components/site-footer.tsx"),
    css: read("styles/auth.css"),
    brandImageClass: "yk-auth-brand-image"
  };
}
