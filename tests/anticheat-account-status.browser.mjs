import fs from "node:fs";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true
});
const results = [];
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
      const page = await browser.newPage({
        viewport: {
          width: Math.round(width / zoom),
          height: Math.round(1000 / zoom)
        },
        deviceScaleFactor: zoom
      });
      const errors = [];
      page.on("pageerror", e => errors.push(e.message));
      await page.context().addCookies([
        {
          name: "yokkai_locale",
          value: `v1:manual:${locale}:seen`,
          domain: "127.0.0.1",
          path: "/"
        }
      ]);
      await page.goto(
        "http://127.0.0.1:3014/design-system/admin-account-status-preview"
      );
      const sources = page.locator('input[name="source_account"]');
      await sources.first().waitFor();
      assert.equal(await sources.count(), 3);
      assert.equal(await sources.nth(0).isDisabled(), true);
      assert.equal(await sources.nth(1).isEnabled(), true);
      await sources.nth(1).check();
      assert.equal(await sources.nth(1).isChecked(), true);
      assert(
        (await page
          .getByText(
            locale === "fr"
              ? "Sanction déjà appliquée"
              : "Sanction already applied",
            { exact: true }
          )
          .count()) > 0
      );
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1
      );
      assert(!overflow);
      assert.deepEqual(errors, []);
      const collision = await page
        .locator("span.border-red-400\\/60")
        .evaluateAll(es =>
          es.some(e => {
            const r = e.getBoundingClientRect();
            return r.left < 0 || r.right > innerWidth + 1;
          })
        );
      assert(!collision);
      results.push({ locale, width, zoom, passed: true });
      if (locale === "fr" && [375, 1440].includes(width) && zoom === 1)
        await page.screenshot({
          path: `.tmp-status-${width}.png`,
          fullPage: true
        });
      await page.close();
    }
  fs.writeFileSync(".tmp-responsive.json", JSON.stringify(results, null, 2));
  console.log(`${results.length} browser scenarios passed`);
} finally {
  await browser.close();
}
