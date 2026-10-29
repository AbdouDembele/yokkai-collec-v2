import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const root = process.cwd().replaceAll("\\", "/") + "/";
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true
});
const results = [];
await fs.mkdir(root + ".tools/chat-release", { recursive: true });
try {
  for (const [width, height, locale, dpr] of [
    [320, 740, "fr", 1],
    [375, 812, "fr", 1],
    [768, 1024, "en", 1],
    [1024, 768, "fr", 1],
    [1440, 900, "fr", 1],
    [720, 450, "fr", 2]
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: dpr,
      timezoneId: "Europe/Paris"
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
    let wanted = false,
      toggles = 0;
    await page.route("**/rest/v1/**", r => {
      const rpc = new URL(r.request().url()).pathname.split("/").at(-1);
      if (rpc === "get_social_unread")
        return r.fulfill({
          json: { viewerId: "", messages: [], messageCount: 0, requestCount: 0 }
        });
      if (rpc === "get_card_discovery")
        return r.fulfill({
          json: {
            card: {
              id: "owned-card",
              name: "Levi",
              category: "ANIME/MANGA",
              anime: "Attack on Titan",
              rarity: "LR",
              image: "/assets/landing/levi.webp"
            },
            wishlisted: wanted,
            marketValue: null,
            activeAuctionId: null,
            ownerCount: 1,
            owners: []
          }
        });
      if (rpc === "toggle_wishlist") {
        toggles++;
        wanted = !wanted;
        return r.fulfill({ json: wanted });
      }
      if (rpc === "cards")
        return r.fulfill({
          json: [{ id: "owned-card", franchise: "Attack on Titan" }]
        });
      if (rpc === "get_card_binder_metadata") return r.fulfill({ json: [] });
      errors.push("Unexpected RPC " + rpc);
      console.log("Unexpected RPC " + rpc);
      return r.abort();
    });
    await page.goto(
      "http://localhost:3012/design-system/market-release-preview"
    );
    const market = page.locator(".yk-market");
    await market.locator(".yk-market-tile").first().waitFor();
    assert.equal(
      await market.locator("h1").innerText(),
      locale === "fr" ? "Marché" : "Market"
    );
    if (locale === "fr") {
      const text = await market.innerText();
      assert(
        !/Ending soon|Most popular|My auctions|Sort by|Reset filters|My active listings|Price:/.test(
          text
        )
      );
    }
    if (await market.locator(".yk-mobile-filter-trigger").isVisible()) {
      await market.locator(".yk-mobile-filter-trigger").click();
      await page
        .getByRole("button", {
          name: locale === "fr" ? "Fermer les filtres" : "Close filters"
        })
        .last()
        .click();
    }
    await market
      .getByRole("tab", {
        name: locale === "fr" ? /Mes enchères/ : /My auctions/
      })
      .click();
    assert.match(
      await market
        .locator(".yk-market-tile")
        .filter({
          has: page.getByText(locale === "fr" ? /Achetée à/ : /Bought from/)
        })
        .first()
        .innerText(),
      locale === "fr" ? /oct\./ : /Oct/
    );
    if (width === 1440)
      await page.screenshot({
        path: root + ".tools/chat-release/market-fr.png"
      });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1
      ),
      false
    );
    await page.goto(
      "http://localhost:3012/design-system/market-release-preview?mode=auction"
    );
    await page.locator(".yk-auction-history time").first().waitFor();
    const expected = new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Paris"
    }).format(new Date("2026-10-29T12:30:00Z"));
    assert.equal(
      await page.locator(".yk-auction-history time").first().innerText(),
      expected
    );
    await page.locator(".yk-auction-chat-list time").first().waitFor();
    assert.equal(
      await page.locator(".yk-auction-chat-list time").first().innerText(),
      expected
    );
    if (locale === "fr") assert.match(expected, /^13:30$/);
    await page.goto(
      "http://localhost:3012/design-system/market-release-preview?mode=wishlist"
    );
    const modal = page.locator(".yk-catalogue-detail-modal[open]");
    await modal.waitFor();
    const add = modal.getByRole("button", {
      name:
        locale === "fr"
          ? /Ajouter à ma liste de souhaits/
          : /Add to my wishlist/
    });
    await add.waitFor();
    await add.click();
    assert.equal(wanted, true);
    const remove = modal.getByRole("button", {
      name:
        locale === "fr"
          ? /Retirer de ma liste de souhaits/
          : /Remove from my wishlist/
    });
    await remove.waitFor();
    await remove.click();
    await add.waitFor();
    assert.equal(wanted, false);
    assert.equal(toggles, 2);
    assert.equal(
      await modal.evaluate(el => el.scrollWidth > el.clientWidth + 1),
      false
    );
    assert.deepEqual(errors, []);
    results.push({
      width,
      locale,
      time: expected,
      ownedWishlist: true,
      zoomLayoutEmulation: dpr === 2,
      nativeBrowserZoomVerified: false,
      passed: true
    });
    await context.close();
  }
  console.log(JSON.stringify(results));
  await fs.writeFile(
    root + ".tools/chat-release/browser.json",
    JSON.stringify(results, null, 2)
  );
} finally {
  await browser.close();
}
