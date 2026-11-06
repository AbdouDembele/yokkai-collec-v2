import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3018";
const browser = await chromium.launch({ channel: "chrome", headless: true });
mkdirSync("artifacts/friend-accepted-notification", { recursive: true });
let scenarios = 0;
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
      await page.route(
        url => !url.href.startsWith(base),
        route => route.abort()
      );
      await page.goto(
        `${base}/design-system/friend-accepted-notification-preview?lang=${locale}`,
        { waitUntil: "domcontentloaded" }
      );
      const bell = page.locator('button[aria-controls="notifications-panel"]');
      await page.waitForFunction(() =>
        Object.keys(
          document.querySelector(
            'button[aria-controls="notifications-panel"]'
          ) ?? {}
        ).some(key => key.startsWith("__reactProps"))
      );

      await bell.click();
      const panel = page.locator("#notifications-panel");
      await panel.waitFor();
      await page.evaluate(() => {
        for (const animation of document.getAnimations()) {
          if (animation.effect?.getComputedTiming().iterations !== Infinity)
            animation.finish();
        }
      });
      const link = panel.locator(
        'a[href="/profile/83000000-0000-4000-8000-000000000002"]'
      );
      assert.ok(
        (await link.innerText()).includes(
          locale === "fr"
            ? "a accept\u00e9 ta demande d\u2019ami."
            : "accepted your friend request."
        )
      );
      assert.equal(await panel.locator("li.is-unread").count(), 1);
      const problems = await page.evaluate(() => {
        const issues = [];
        if (document.documentElement.scrollWidth > window.innerWidth + 1)
          issues.push("page overflow");
        const panel = document.querySelector("#notifications-panel"),
          rect = panel.getBoundingClientRect();
        if (rect.left < -0.5 || rect.right > window.innerWidth + 0.5)
          issues.push("panel outside viewport");
        if (panel.scrollWidth > panel.clientWidth + 1)
          issues.push("notification text overflow");
        return issues;
      });
      assert.deepEqual(problems, [], `${locale} ${width}px zoom ${zoom}`);
      if (locale === "fr" && zoom === 1 && (width === 375 || width === 1440))
        await page.screenshot({
          path: `artifacts/friend-accepted-notification/${width}.png`,
          fullPage: true
        });
      await link.click();
      await page.waitForFunction(
        () =>
          document.querySelectorAll("#notifications-panel li.is-unread")
            .length === 0
      );
      assert.equal(await panel.locator("li.is-read").count(), 1);
      scenarios++;
      await page.close();
    }
  console.log(
    JSON.stringify({ responsiveScenarios: scenarios, readOnOpen: "passed" })
  );
} finally {
  await browser.close();
}
