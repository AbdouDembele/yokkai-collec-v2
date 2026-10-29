import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright-core";
const dir = ".tools/chat-profile-proof";
await fs.mkdir(dir, { recursive: true });
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
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.route("**/rest/v1/**", r => {
      if (
        new URL(r.request().url()).pathname.endsWith("/rpc/get_social_unread")
      )
        return r.fulfill({
          json: {
            viewerId: "",
            messages: [],
            messageCount: 0,
            requestCount: 0
          }
        });
      errors.push(
        "Unexpected database request: " + r.request().url().split("?")[0]
      );
      return r.abort();
    });
    await page.goto("http://localhost:3012/design-system/chat-profile-preview");
    const chat = page.locator(".yk-auction-chat-list");
    await chat.waitFor();
    assert.equal(
      await page
        .locator(
          '.yk-private-message-row .yk-styled-player-avatar[data-avatar-frame="bloodmoon"]'
        )
        .count(),
      1
    );
    await page.locator(".yk-messenger-launcher").click();
    assert.equal(
      await chat
        .locator('.yk-styled-player-avatar[data-avatar-frame="bloodmoon"]')
        .count(),
      1
    );
    assert.equal(await chat.locator(".yk-auction-chat-mention").count(), 4);
    assert.equal(
      await chat.locator("button").filter({ hasText: "@Unknown" }).count(),
      0
    );
    const mainWidth = await page
      .locator("main")
      .first()
      .evaluate(el => el.getBoundingClientRect().width);
    const trigger = chat
      .getByRole("button", {
        name:
          locale === "fr" ? "Voir le profil de Alice" : "View Alice’s profile"
      })
      .first();
    await trigger.click();
    const modal = page.locator(".yk-player-preview[open]");
    await modal.locator(".yk-profile-identity").waitFor();
    assert.equal(await modal.locator(".yk-profile-compact-board").count(), 1);
    assert.equal(
      await modal.locator(".yk-profile-showcase .yk-card").count(),
      3
    );
    await modal.locator(".yk-profile-album-progress li").nth(2).waitFor();
    assert.equal(
      await modal.locator(".yk-profile-album-progress li").count(),
      3
    );
    assert.equal(
      await modal
        .locator(".yk-profile-album-progress progress")
        .first()
        .getAttribute("value"),
      "12"
    );
    const positions = await modal.evaluate(el => {
      const side = el
        .querySelector(".yk-profile-identity")
        .getBoundingClientRect();
      const board = el
        .querySelector(".yk-profile-compact-board")
        .getBoundingClientRect();
      return {
        side: {
          left: side.left,
          top: side.top,
          bottom: side.bottom,
          right: side.right
        },
        board: {
          left: board.left,
          top: board.top,
          bottom: board.bottom,
          right: board.right
        }
      };
    });
    if (width >= 760) assert(positions.board.left >= positions.side.right);
    else assert(positions.board.top >= positions.side.bottom);
    assert.equal(
      await modal
        .locator(".yk-profile-side-stats strong")
        .allTextContents()
        .then(a => a.join(",")),
      "255,5,6"
    );
    const box = await modal.boundingBox();
    assert(box.width <= Math.min(1120, width - 24));
    assert(box.x >= 0 && box.x + box.width <= width + 1);
    assert(box.y >= 0 && box.y + box.height <= height + 1);
    assert.equal(
      await modal.evaluate(el => el.scrollWidth > el.clientWidth + 1),
      false
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1
      ),
      false
    );
    assert.equal(
      await page
        .locator("main")
        .first()
        .evaluate(el => el.getBoundingClientRect().width),
      mainWidth
    );
    if (width === 1440 || width === 375)
      await page.screenshot({
        path: dir + "/compact-" + width + "-" + locale + ".png"
      });
    const like = modal.locator(
      ".yk-profile-identity-content > button[aria-pressed]"
    );
    await like.click();
    assert.equal(await like.getAttribute("aria-pressed"), "true");
    assert.equal(await modal.locator("[data-profile-likes]").innerText(), "8");
    const friend = modal.locator(".yk-profile-actions button").first();
    await friend.click();
    assert.match(
      await modal.locator(".yk-profile-actions").innerText(),
      locale === "fr" ? /envoyée/i : /sent/i
    );
    await modal.locator(".yk-profile-side-counts > button").first().click();
    const collection = page.locator(".yk-friend-card-grid-modal[open]");
    await collection.locator(".yk-card").first().waitFor();
    assert((await collection.locator(".yk-card").count()) >= 1);
    await page.keyboard.press("Escape");
    await collection.waitFor({ state: "hidden" });
    assert(await modal.isVisible());
    await modal.locator(".yk-profile-side-counts > button").nth(1).click();
    const wishlist = page
      .locator(".yk-friend-collection-modal[open]")
      .filter({ hasNot: page.locator(".yk-profile-identity") });
    await wishlist.waitFor();
    await page.keyboard.press("Escape");
    await wishlist.waitFor({ state: "hidden" });
    await page.keyboard.press("Escape");
    await modal.waitFor({ state: "hidden" });
    await page.waitForFunction(
      () =>
        document.activeElement?.classList.contains("yk-auction-chat-mention"),
      null,
      { timeout: 2000 }
    );
    assert(await trigger.evaluate(el => el === document.activeElement));
    await chat
      .getByRole("button", {
        name:
          locale === "fr"
            ? "Voir le profil de Private Player"
            : "View Private Player’s profile"
      })
      .click();
    await modal.locator(".yk-profile-identity").waitFor();
    assert.equal(await modal.locator(".yk-card").count(), 0);
    assert.equal(
      await modal.locator(".yk-profile-album-progress li").count(),
      0
    );
    assert.equal(
      await modal
        .locator(".yk-profile-side-counts > button:not(:disabled)")
        .count(),
      0
    );
    assert.equal(
      await modal
        .locator(".yk-profile-side-stats strong")
        .allTextContents()
        .then(a => a.every(s => s === (locale === "fr" ? "Privé" : "Private"))),
      true
    );
    await page.keyboard.press("Escape");
    await chat
      .getByRole("button", {
        name:
          locale === "fr"
            ? "Voir le profil de Retry Player"
            : "View Retry Player’s profile"
      })
      .click();
    await modal.getByRole("alert").waitFor();
    await modal
      .getByRole("button", {
        name: locale === "fr" ? "Réessayer" : "Try again"
      })
      .click();
    await modal.locator(".yk-profile-identity").waitFor();
    await page.keyboard.press("Escape");
    assert.deepEqual(errors, []);
    results.push({
      width,
      height,
      locale,
      dpr,
      compact: true,
      zoomLayoutEmulation: dpr === 2,
      nativeBrowserZoomVerified: false,
      passed: true
    });
    await context.close();
  }
  await fs.writeFile(
    dir + "/compact-results.json",
    JSON.stringify(results, null, 2)
  );
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
