import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
await mkdir(".tools/chat-profile-proof", { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true
});
const results = [];
try {
  for (const [width, height, locale, dpr] of [
    [320, 740, "en", 1],
    [375, 812, "fr", 1],
    [768, 1024, "en", 1],
    [1024, 768, "fr", 1],
    [1440, 900, "en", 1],
    [720, 450, "fr", 2]
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: dpr
    });
    await context.addCookies([
      {
        name: "yokkai_locale",
        value: "v1:manual:" + locale + ":seen",
        url: "http://localhost:3012"
      }
    ]);
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.route("**/rest/v1/**", r => {
      if (
        new URL(r.request().url()).pathname.endsWith("/rpc/get_social_unread")
      )
        return r.fulfill({
          json: { viewerId: "", messages: [], messageCount: 0, requestCount: 0 }
        });
      errors.push("Unexpected RPC: " + r.request().url().split("?")[0]);
      return r.abort();
    });
    for (const full of [true, false]) {
      await page.goto(
        "http://localhost:3012/design-system/chat-profile-preview?friend=1" +
          (full ? "&full=1" : "")
      );
      if (!full) {
        await page.locator(".yk-auction-chat-list").waitFor();
        await page
          .locator('.yk-messenger[data-open="true"] > .yk-messenger-launcher')
          .click();
        await page.locator(".yk-auction-chat-mention").first().click();
      }
      const button = page.locator("[data-profile-message]");
      await button.waitFor();
      assert.equal(
        await button.innerText(),
        locale === "fr" ? "Message" : "Message"
      );
      const originalUrl = page.url();
      await button.click();
      const dm = page.locator(".yk-private-messages-modal[open]");
      await dm.locator(".yk-private-message").first().waitFor();
      assert.equal(page.url(), originalUrl);
      assert.equal(
        await dm
          .locator(
            '.yk-private-messages-contact [data-avatar-frame="bloodmoon"]'
          )
          .count(),
        1
      );
      const box = await dm.boundingBox();
      assert(
        box.x >= 0 &&
          box.x + box.width <= width + 1 &&
          box.y >= 0 &&
          box.y + box.height <= height + 1
      );
      assert.equal(
        await dm.evaluate(el => el.scrollWidth > el.clientWidth + 1),
        false
      );
      assert.equal(await dm.locator(".yk-message-emoji-trigger").count(), 1);
      await dm.locator("textarea").fill("Test message local");
      await dm.locator('button[type="submit"]').click();
      await dm.getByText("Test message local", { exact: true }).waitFor();
      assert.equal(await dm.locator("textarea").inputValue(), "");
      if (width === 1440 && full) {
        await dm.evaluate(async el => {
          await Promise.all(
            el.getAnimations().map(a => a.finished.catch(() => {}))
          );
        });
        await page.screenshot({
          path: ".tools/chat-profile-proof/message-from-profile.png"
        });
      }
      await page.keyboard.press("Escape");
      await dm.waitFor({ state: "hidden" });
      await page.waitForFunction(() =>
        document.activeElement?.hasAttribute("data-profile-message")
      );
      if (!full) {
        assert(await page.locator(".yk-player-preview[open]").isVisible());
        await page.keyboard.press("Escape");
      }
    }
    for (const suffix of ["&full=1", "&friend=1&full=1&blocked=1"]) {
      await page.goto(
        "http://localhost:3012/design-system/chat-profile-preview?" +
          suffix.slice(1)
      );
      await page.locator(".yk-profile-identity").waitFor();
      assert.equal(await page.locator("[data-profile-message]").count(), 0);
    }
    assert.deepEqual(errors, []);
    results.push({
      width,
      locale,
      fullAndCompact: true,
      friendAndBlockGates: true,
      zoomLayoutEmulation: dpr === 2,
      nativeBrowserZoomVerified: false,
      passed: true
    });
    await context.close();
  }
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
