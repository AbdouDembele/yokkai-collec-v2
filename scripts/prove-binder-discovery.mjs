import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright-core";
const dir = ".tools/binders-proof";
const baseURL = process.env.PREVIEW_URL ?? "http://localhost:3000";
await fs.mkdir(dir, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true
});
const results = [];
try {
  for (const [width, height, locale, dpr] of [
    [320, 740, "fr", 1],
    [375, 812, "en", 1],
    [600, 900, "fr", 1],
    [768, 1024, "fr", 1],
    [900, 900, "en", 1],
    [1024, 768, "en", 1],
    [1440, 900, "fr", 1],
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
        url: baseURL
      }
    ]);
    const page = await context.newPage(),
      errors = [],
      writes = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.route("**/rest/v1/**", r => {
      if (r.request().method() !== "GET")
        writes.push(new URL(r.request().url()).pathname);
      return r.abort();
    });
    const url = baseURL + "/design-system/binders-preview?mode=";
    const check = async label => {
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1
        ),
        false,
        label + " page overflow at " + width
      );
      const tooWide = await page
        .locator(
          ".yk-collection-tabs,.yk-home-binder-card,.yk-pack-binder-progress"
        )
        .evaluateAll(nodes =>
          nodes
            .filter(n => n.scrollWidth > n.clientWidth + 2)
            .map(n => n.className)
        );
      assert.deepEqual(tooWide, [], label + " overflowing containers");
    };
    await page.goto(url + "home");
    await page.locator(".yk-home-binder-card").nth(2).waitFor();
    assert.equal(await page.locator(".yk-home-binder-card").count(), 3);
    assert.equal(
      await page.locator(".yk-home-binder-card").first().getAttribute("href"),
      "/collection?view=binders&binder=series%3A10000000-0000-4000-8000-000000000001&name=Jujutsu+Kaisen"
    );
    await check("home");
    if (width === 1440 || width === 320)
      await page.screenshot({
        path: dir + "/home-" + width + ".png",
        fullPage: true
      });
    await page
      .getByRole("button", { name: "Toggle empty", exact: true })
      .click();
    await page.locator(".yk-binder-empty a").waitFor();
    await page
      .getByRole("button", { name: "Toggle failure", exact: true })
      .click();
    await page.locator(".yk-binder-empty button").waitFor();
    await check("home empty/error");
    await page.goto(url + "collection");
    const binderButton = page.getByRole("button", {
      name: locale === "fr" ? "Mes classeurs" : "My binders",
      exact: true
    });
    const cardsButton = page.getByRole("button", {
      name: locale === "fr" ? "Mes cartes" : "My cards",
      exact: true
    });
    await binderButton.click();
    await page.locator(".yk-panini-album-open").nth(3).waitFor();
    assert.equal(await binderButton.getAttribute("aria-pressed"), "true");
    await check("binders list");
    if (width === 1440 || width === 320)
      await page.screenshot({
        path: dir + "/collection-" + width + ".png",
        fullPage: true
      });
    await page.locator(".yk-panini-album-open").first().click();
    await page.locator(".yk-panini-album-head h2").waitFor();
    await check("open binder");
    await cardsButton.click();
    assert.equal(await cardsButton.getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator(".yk-panini").count(), 0);
    await page.goto(
      url +
        "collection&view=binders&binder=series%3A10000000-0000-4000-8000-000000000002&name=Attack+on+Titan"
    );
    await page
      .locator(".yk-panini-album-head h2")
      .getByText("Attack on Titan", { exact: true })
      .waitFor();
    await page.locator("#binder-cards-list .yk-card").first().waitFor();
    await check("direct binder");
    await page.goto(url + "discovery");
    await binderButton.click();
    await page.locator(".yk-panini-album-open").nth(3).waitFor();
    await page.waitForFunction(() =>
      document
        .querySelector(".yk-panini-album-open")
        ?.textContent?.includes("One Piece")
    );
    assert.ok(
      (
        await page.locator(".yk-panini-album-open").first().textContent()
      ).includes("One Piece")
    );
    await check("popular discovery without personal favorites");
    await page.goto(url + "packs");
    await page.locator(".yk-pack-binder-progress li").nth(2).waitFor();
    assert.equal(await page.locator(".yk-pack-binder-progress li").count(), 3);
    assert.equal(
      await page
        .locator(".yk-pack-binder-progress")
        .getByText("Satoru Gojo", { exact: true })
        .count(),
      1
    );
    await check("pack results");
    if (width === 1440 || width === 320)
      await page.screenshot({
        path: dir + "/packs-" + width + ".png",
        fullPage: true
      });
    await page
      .getByRole("button", { name: "Toggle Decision Pack", exact: true })
      .click();
    await page.locator(".yk-reveal-grid-choosing").waitFor();
    assert.equal(
      await page.locator(".yk-pack-binder-progress").count(),
      0,
      "unkept Decision cards must not advance binders"
    );
    const keep = page.locator(".yk-slot-button").first();
    await keep.click();
    const modal = page.locator("dialog[open]");
    await modal.locator(".yk-button-primary").click();
    await page.locator(".yk-pack-binder-progress li").waitFor();
    assert.equal(await page.locator(".yk-pack-binder-progress li").count(), 1);
    await check("kept Decision card");
    assert.deepEqual(errors, []);
    // Fixtures never issue pack, favorite or wishlist mutations.
    assert.equal(
      writes.some(p =>
        /open_.*pack|keep_decision|set_binder_favorite|toggle_wishlist/.test(p)
      ),
      false
    );
    results.push({
      width,
      locale,
      home: true,
      tabs: true,
      directBinder: true,
      packProgress: true,
      decisionGate: true,
      zoomLayoutEmulation: dpr === 2,
      nativeBrowserZoomVerified: false
    });
    await context.close();
  }
  await fs.writeFile(dir + "/browser.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
