import fs from "node:fs";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3015";
const b = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true
});
const results = [];
const source = "ac680000-0000-4000-8000-000000000003",
  processed = "ac680000-0000-4000-8000-000000000004",
  active = "ac680000-0000-4000-8000-000000000002";
try {
  for (const locale of ["en", "fr"])
    for (const [width, zoom] of [
      [320, 1],
      [375, 1],
      [768, 1],
      [1024, 1],
      [1440, 1],
      [1024, 2],
      [1440, 2]
    ]) {
      const p = await b.newPage({
        viewport: {
          width: Math.round(width / zoom),
          height: Math.round(1000 / zoom)
        },
        deviceScaleFactor: zoom
      });
      const errors = [];
      p.on("pageerror", e => errors.push(e.message));
      await p.context().addCookies([
        {
          name: "yokkai_locale",
          value: `v1:manual:${locale}:seen`,
          domain: "127.0.0.1",
          path: "/"
        }
      ]);
      await p.route(`${base}/admin/security**`, async route => {
        assert.equal(route.request().method(), "GET");
        const url = new URL(route.request().url());
        await route.fulfill({
          status: 302,
          headers: {
            location: `/design-system/related-accounts-preview${url.search}#sanction-preview`
          },
          body: ""
        });
      });
      await p.goto(`${base}/design-system/related-accounts-preview`);
      const check = p.locator(
          `input[type=checkbox][name=source_account][value="${source}"]`
        ),
        disabled = p.locator(
          `input[type=checkbox][name=source_account][value="${processed}"]`
        );
      await check.waitFor();
      assert.equal(await check.isEnabled(), true);
      assert.equal(await disabled.isDisabled(), true);
      assert.equal(await p.locator("select[name=primary]").count(), 0);
      const geometry = await p.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        cards: [...document.querySelectorAll("[data-related-account]")].map(
          e => {
            const r = e.getBoundingClientRect();
            return { left: r.left, right: r.right };
          }
        )
      }));
      assert(!geometry.overflow);
      assert(
        geometry.cards.every(
          r => r.left >= 0 && r.right <= Math.round(width / zoom) + 1
        )
      );
      if (locale === "fr" && [375, 1440].includes(width) && zoom === 1)
        await p.screenshot({
          path: `.tmp-related-${width}.png`,
          fullPage: true
        });
      await check.check();
      await p
        .getByRole("button", {
          name:
            locale === "fr"
              ? "Prévisualiser les sources supprimées sélectionnées"
              : "Preview the selected deleted sources",
          exact: true
        })
        .click();
      await p.waitForURL(
        u =>
          u.searchParams.get("source_account") === source &&
          u.pathname.endsWith("related-accounts-preview")
      );
      assert.equal(new URL(p.url()).searchParams.get("mode"), "deleted");
      await p
        .getByRole("link", {
          name: locale === "fr" ? "Suivant" : "Next",
          exact: true
        })
        .click();
      await p.waitForURL(u => u.searchParams.get("linked_page") === "2");
      assert.equal(new URL(p.url()).searchParams.get("source_account"), source);
      const household = p.locator(
        '[data-related-account="ac680000-0000-4000-8000-000000000006"]'
      );
      assert.equal(await household.locator("a").count(), 0);
      await p.locator("input[name=linked_q]:not([type=hidden])").fill("Faker");
      await p
        .getByRole("button", {
          name: locale === "fr" ? "Rechercher" : "Search",
          exact: true
        })
        .click();
      await p.waitForURL(u => u.searchParams.get("linked_q") === "Faker");
      assert.equal(new URL(p.url()).searchParams.get("source_account"), source);
      assert.equal(await p.locator("[data-related-account]").count(), 1);
      await p
        .getByRole("link", {
          name: locale === "fr" ? "Examiner ce compte" : "Examine this account",
          exact: true
        })
        .click();
      await p.waitForURL(
        u =>
          u.searchParams.get("primary") === active &&
          u.pathname.endsWith("related-accounts-preview")
      );
      assert.equal(new URL(p.url()).searchParams.get("role"), "primary");
      assert.equal(new URL(p.url()).searchParams.get("mode"), "active");
      assert.deepEqual(errors, []);
      results.push({ locale, width, zoom, passed: true });
      fs.writeFileSync(
        ".tmp-related-responsive.json",
        JSON.stringify(results, null, 2)
      );
      await p.close();
    }
  console.log(`${results.length} responsive and selection scenarios passed`);
} finally {
  await b.close();
}
