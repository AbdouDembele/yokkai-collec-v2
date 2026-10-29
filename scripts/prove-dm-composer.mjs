import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const origin = process.env.DM_PREVIEW_ORIGIN ?? "http://localhost:3012";
assert(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const dir = resolve(".tools/dm-composer-proof");
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true
});
const results = [];
const tall = {
  id: "TallFixture",
  title: "Tall fixture",
  rating: "g",
  images: {
    original: {
      url: "https://media.giphy.com/media/TallFixture/giphy.gif",
      width: "240",
      height: "1200"
    },
    fixed_width_small: {
      url: "https://media.giphy.com/media/TallFixture/preview.gif",
      width: "200",
      height: "1000"
    }
  }
};
const wide = {
  id: "WideFixture",
  title: "Wide fixture",
  rating: "pg",
  images: {
    original: {
      url: "https://media.giphy.com/media/WideFixture/giphy.gif",
      width: "1200",
      height: "240"
    }
  }
};
async function geometry(page) {
  await page.evaluate(
    () =>
      new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  );
  const box = await page.locator(".yk-gif-modal[open]").evaluate(el => {
    const rect = n => {
      const r = n.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    return {
      modal: rect(el),
      title: rect(el.querySelector("h2")),
      image: rect(el.querySelector(".yk-gif-preview img")),
      buttons: [...el.querySelectorAll(".yk-gif-preview button")].map(rect),
      width: innerWidth,
      height: innerHeight
    };
  });
  assert(
    box.modal.left >= 0 &&
      box.modal.right <= box.width &&
      box.modal.top >= 0 &&
      box.modal.bottom <= box.height,
    "GIF modal outside viewport " + JSON.stringify(box)
  );
  assert(
    box.image.top >= box.title.bottom,
    "GIF overlaps title " + JSON.stringify(box)
  );
  for (const b of box.buttons)
    assert(
      b.top >= box.image.bottom && b.bottom <= box.modal.bottom,
      "GIF overlaps buttons " + JSON.stringify(box)
    );
  return box;
}
try {
  for (const size of [
    { width: 320, height: 900 },
    { width: 375, height: 900 },
    { width: 768, height: 900 },
    { width: 1024, height: 900 },
    { width: 1440, height: 900 },
    { width: 375, height: 550, locale: "fr" },
    { width: 720, height: 450, density: 2 },
    { width: 375, height: 900, mode: "modal" }
  ]) {
    const locale = size.locale ?? "en",
      m = JSON.parse(readFileSync("messages/" + locale + ".json", "utf8"));
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.density ?? 1
    });
    await context.addCookies([
      {
        name: "yokkai_locale",
        value: "v1:manual:" + locale + ":seen",
        url: origin
      }
    ]);
    let rejected = false,
      verifyCalls = 0,
      giphyCalls = 0;
    await context.route("https://api.giphy.com/**", route => {
      giphyCalls++;
      return route.fulfill({
        json: { data: [tall, wide], pagination: { count: 2, total_count: 2 } }
      });
    });
    await context.route("https://media.giphy.com/**", route =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: route.request().url().includes("Tall")
          ? '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="1200"><rect width="240" height="1200" fill="#e89"/><text x="10" y="600">Tall GIF fixture</text></svg>'
          : '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="240"><rect width="1200" height="240" fill="#89e"/></svg>'
      })
    );
    await context.route("**/api/gifs/verify", route => {
      verifyCalls++;
      return route.fulfill({ json: { allowed: !rejected } });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(
      origin +
        "/design-system/dm-composer-preview" +
        (size.mode ? "?mode=" + size.mode : ""),
      { waitUntil: "domcontentloaded", timeout: 60000 }
    );
    const input = page.locator(".yk-private-messages-compose textarea");
    await input.waitFor();
    const toolbar = await page
      .locator(".yk-private-messages-toolbar")
      .evaluate(el => {
        const r = el.getBoundingClientRect();
        return [...el.children].map(child => {
          const c = child.getBoundingClientRect();
          return {
            left: c.left,
            right: c.right,
            parentLeft: r.left,
            parentRight: r.right
          };
        });
      });
    assert(
      toolbar.every(
        r => r.left >= r.parentLeft - 1 && r.right <= r.parentRight + 1
      ),
      "Composer toolbar is clipped"
    );
    if (size.width === 320)
      await page.screenshot({ path: resolve(dir, "composer-320.png") });
    await input.fill("abcd");
    assert.equal(
      await page.getByText(m.privateMessages.hint, { exact: true }).count(),
      0,
      "Keyboard hint remains visible"
    );
    await input.evaluate(el => {
      el.focus();
      el.setSelectionRange(1, 3);
    });
    await page
      .getByRole("button", { name: m.privateMessages.addEmoji, exact: true })
      .click();
    const picker = page.locator(".yk-reaction-modal[open]");
    await picker.waitFor();
    assert.equal(
      await picker
        .locator(".yk-reaction-grid")
        .evaluate(el => getComputedStyle(el).display),
      "grid",
      "Emoji picker styles missing outside Social"
    );
    assert(
      await picker
        .locator(".yk-reaction-grid button")
        .first()
        .evaluate(el => el.getBoundingClientRect().width >= 28),
      "Emoji choices are too small"
    );
    assert(
      await picker.evaluate(el => el.getBoundingClientRect().width <= 420),
      "Emoji dialog must stay compact"
    );
    const fire = m.profileUi.emojiFire;
    await picker.locator("input[type=search]").fill(fire);
    assert.equal(
      await picker.locator(".yk-reaction-grid button").count(),
      1,
      "Translated emoji search failed"
    );
    await picker
      .getByRole("button", {
        name: m.privateMessages.insertEmoji.replace("{label}", fire),
        exact: true
      })
      .click();
    await input.waitFor();
    assert.equal(await input.inputValue(), "a🔥d");
    assert.equal(await input.evaluate(el => el.selectionStart), 3);
    await page.waitForFunction(
      () => document.activeElement?.tagName === "TEXTAREA"
    );
    assert.equal(
      await page.locator("[data-preview-attempts]").innerText(),
      "0",
      "Emoji picker must not send immediately"
    );
    await page
      .locator(".yk-private-messages-compose button[type=submit]")
      .click();
    await page
      .locator(".yk-private-message p")
      .getByText("a🔥d", { exact: true })
      .waitFor();
    assert.equal(await input.inputValue(), "");
    await page.locator(".yk-gif-trigger").click();
    const gifs = page.locator(".yk-gif-modal[open]");
    await gifs.locator(".yk-gif-results button").first().waitFor();
    await page.waitForTimeout(350);
    await gifs.locator(".yk-gif-results button").first().click();
    await gifs.locator(".yk-gif-preview img").evaluate(el => el.decode());
    const tallBox = await geometry(page);
    if (size.width === 320 || size.width === 1440)
      await page.screenshot({
        path: resolve(dir, "gif-" + size.width + ".png")
      });
    await gifs
      .getByRole("button", { name: m.packs.cancel, exact: true })
      .click();
    await gifs.locator(".yk-gif-results button").last().click();
    await geometry(page);
    await page.keyboard.press("Escape");
    await page.locator(".yk-gif-modal[open]").waitFor({ state: "hidden" });
    assert.equal(
      await page.locator(".yk-private-messages-compose").count(),
      1,
      "Escape closed the conversation"
    );
    await page.locator(".yk-gif-trigger").click();
    await gifs.locator(".yk-gif-results button").first().click();
    rejected = true;
    await gifs
      .getByRole("button", { name: m.profileUi.sendThisGif, exact: true })
      .click();
    await gifs.getByRole("alert").waitFor();
    assert.equal(
      await page.locator(".yk-private-messages-gif-draft").count(),
      0,
      "Rejected GIF reached draft"
    );
    rejected = false;
    await gifs
      .getByRole("button", { name: m.profileUi.sendThisGif, exact: true })
      .click();
    await page.locator(".yk-private-messages-gif-draft").waitFor();
    assert(verifyCalls === 2, "Rating verification bypassed");
    await input.fill("Caption");
    await page
      .getByRole("button", { name: "Toggle send failure", exact: true })
      .evaluate(el => el.click());
    await page
      .locator(".yk-private-messages-compose button[type=submit]")
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector("[data-preview-attempts]").textContent === "2"
    );
    assert.equal(await input.inputValue(), "Caption");
    assert.equal(
      await page.locator(".yk-private-messages-gif-draft").count(),
      1,
      "Failure erased GIF"
    );
    await page
      .getByRole("button", { name: "Toggle send failure", exact: true })
      .evaluate(el => el.click());
    await page
      .locator(".yk-private-messages-compose button[type=submit]")
      .click();
    await page.locator(".yk-private-message-gif").waitFor();
    await page
      .locator(".yk-private-messages-gif-draft")
      .waitFor({ state: "hidden" });
    assert.equal(await input.inputValue(), "");
    await page
      .getByRole("button", { name: m.privateMessages.addEmoji, exact: true })
      .click();
    await picker.locator(".yk-reaction-grid button").first().click();
    const emojiOnly = await input.inputValue();
    assert.equal(emojiOnly, "👍");
    await page
      .locator(".yk-private-messages-compose button[type=submit]")
      .click();
    await page
      .locator(".yk-private-message p")
      .getByText("👍", { exact: true })
      .waitFor();
    assert(giphyCalls > 0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth
    );
    assert(!overflow, "Page overflow");
    results.push({
      width: size.width,
      height: size.height,
      locale,
      mode: size.mode ?? "docked",
      zoomLayoutEmulation: !!size.density,
      nativeBrowserZoomVerified: false,
      tallBox,
      emojiInsertionAndSend: true,
      rejectedGifBlocked: true,
      failedSendPreservesDraft: true,
      result: "passed"
    });
    await context.close();
  }
  console.log(JSON.stringify(results));
} finally {
  await writeFile(
    resolve(dir, "results.json"),
    JSON.stringify(results, null, 2)
  );
  await browser.close();
}
