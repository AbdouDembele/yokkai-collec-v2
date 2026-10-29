import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const origin = process.env.LAYOUT_PREVIEW_ORIGIN ?? "http://localhost:3012";
assert(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const directory = resolve(".tools/layout-overflow-proof");
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true
});
const results = [];
async function settle(page) {
  await page.evaluate(
    () =>
      new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  );
}
async function check(page, label) {
  await settle(page);
  const geometry = await page.evaluate(() => {
    const rect = selector => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return {
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
        height: r.height
      };
    };
    return {
      width: innerWidth,
      height: innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      footer: rect(".yk-site-footer"),
      dock: rect(".yk-messenger"),
      panel: document.querySelector(".yk-messenger-panel")
        ? rect(".yk-messenger-panel")
        : null
    };
  });
  assert(
    geometry.documentWidth <= geometry.width + 1,
    label + ": horizontal page overflow " + JSON.stringify(geometry)
  );
  assert(
    geometry.dock.bottom <= Math.min(geometry.height, geometry.footer.top) - 10,
    label + ": messenger overlaps footer " + JSON.stringify(geometry)
  );
  assert(
    geometry.dock.top >= 0 &&
      geometry.dock.right <= geometry.width &&
      geometry.dock.left >= 0,
    label + ": dock outside viewport"
  );
  if (geometry.panel)
    assert(
      geometry.panel.top >= 5 &&
        geometry.panel.left >= 0 &&
        geometry.panel.right <= geometry.width + 1,
      label + ": panel outside viewport " + JSON.stringify(geometry)
    );
  return geometry;
}
try {
  for (const size of [
    { width: 320, height: 900 },
    { width: 375, height: 900 },
    { width: 768, height: 900 },
    { width: 1024, height: 900 },
    { width: 1440, height: 900 },
    { width: 375, height: 900, locale: "fr" },
    { width: 720, height: 450, density: 2 }
  ]) {
    const locale = size.locale ?? "en";
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.density ?? 1,
      locale: locale === "fr" ? "fr-FR" : "en-US"
    });
    await context.addCookies([
      {
        name: "yokkai_locale",
        value: "v1:manual:" + locale + ":seen",
        url: origin
      }
    ]);
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(origin + "/design-system/floating-layout-preview", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
    await page.waitForFunction(
      () =>
        !!document
          .querySelector(".yk-messenger")
          ?.style.getPropertyValue("--yk-messenger-footer-clearance")
    );
    await page.evaluate(() => document.fonts.ready);
    const list = page.locator(".yk-auction-history-list");
    await list.waitFor();
    assert.equal(await list.locator("li").count(), 100);
    const bounded = await list.evaluate(el => ({
      height: el.clientHeight,
      content: el.scrollHeight
    }));
    assert(
      bounded.height <= 384 && bounded.content > bounded.height * 5,
      "history is not bounded"
    );
    await list.focus();
    await list.press("End");
    await page.waitForFunction(() => {
      const el = document.querySelector(".yk-auction-history-list");
      return el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
    });
    const height100 = await page.evaluate(
      () => document.documentElement.scrollHeight
    );
    await page.getByRole("button", { name: "Five bids", exact: true }).click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".yk-auction-history-list li").length === 5
    );
    const height5 = await page.evaluate(
      () => document.documentElement.scrollHeight
    );
    assert(
      Math.abs(height100 - height5) < 180,
      "history grows the page indefinitely"
    );
    await page
      .getByRole("button", { name: "One hundred bids", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".yk-auction-history-list li").length === 100
    );
    await page.evaluate(() => scrollTo(0, 0));
    await check(page, "top");
    await page.evaluate(() =>
      scrollTo(
        0,
        document.querySelector(".yk-site-footer").getBoundingClientRect().top +
          scrollY -
          innerHeight +
          40
      )
    );
    await check(page, "partial-footer");
    await page.evaluate(() =>
      scrollTo(0, document.documentElement.scrollHeight)
    );
    const closed = await check(page, "footer-closed");
    await page.locator(".yk-messenger-launcher").click();
    await page.locator(".yk-messenger-panel").waitFor();
    const opened = await check(page, "footer-open");
    assert(
      await page.locator(".yk-site-footer a").evaluateAll(links =>
        links.every(link => {
          const rect = link.getBoundingClientRect();
          return link.contains(
            document.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2
            )
          );
        })
      ),
      "Footer links are obstructed"
    );
    if (size.width === 375 && locale === "en") {
      await page
        .getByRole("button", { name: "Resize footer", exact: true })
        .evaluate(el => el.click());
      await page.evaluate(() =>
        scrollTo(0, document.documentElement.scrollHeight)
      );
      await check(page, "resized-footer");
      await page.setViewportSize({ width: 320, height: 700 });
      await page.evaluate(() =>
        scrollTo(0, document.documentElement.scrollHeight)
      );
      await check(page, "resized-window");
      await page.evaluate(() => {
        const old = document.querySelector(".yk-site-footer");
        const next = old.cloneNode(true);
        next.style.paddingTop = "24px";
        old.replaceWith(next);
      });
      await page.evaluate(() =>
        scrollTo(0, document.documentElement.scrollHeight)
      );
      await check(page, "replaced-footer");
      await page
        .locator(".yk-messenger")
        .evaluate(el =>
          el.style.setProperty("--yk-messenger-edge-gap", "34px")
        );
      await check(page, "mobile-safe-area");
      await page.evaluate(() => {
        const stage = document.createElement("div");
        stage.className = "yk-opening-stage";
        document.body.append(stage);
      });
      assert.equal(
        await page
          .locator(".yk-messenger")
          .evaluate(el => getComputedStyle(el).display),
        "none",
        "Messenger must stay hidden during pack opening"
      );
      await page.locator(".yk-opening-stage").evaluate(el => el.remove());
    }
    if (size.width === 320 || size.width === 1440)
      await page.screenshot({
        path: resolve(directory, "layout-" + size.width + ".png")
      });
    results.push({
      width: size.width,
      height: size.height,
      locale,
      layoutZoomEmulation: !!size.density,
      nativeBrowserZoomVerified: false,
      boundedHistory: bounded,
      pageHeights: { five: height5, hundred: height100 },
      closed,
      opened,
      result: "passed"
    });
    await context.close();
  }
  console.log(JSON.stringify(results));
} finally {
  await writeFile(
    resolve(directory, "results.json"),
    JSON.stringify(results, null, 2)
  );
  await browser.close();
}
