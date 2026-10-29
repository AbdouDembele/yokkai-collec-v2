import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
const origin = process.env.TRADE_PREVIEW_ORIGIN ?? "http://localhost:3012";
assert(
  ["localhost", "127.0.0.1"].includes(new URL(origin).hostname),
  "Isolated loopback fixtures only"
);
const directory = resolve(".tools/trade-paths-proof");
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true
});
const results = [];
async function fixture(
  entry = "notification",
  extra = "",
  width = 1024,
  locale = "en",
  density = 1
) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: density,
    locale: locale === "fr" ? "fr-FR" : "en-US"
  });
  await context.addCookies([
    { name: "yokkai_locale", value: `v1:manual:${locale}:seen`, url: origin }
  ]);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await page.goto(
    `${origin}/design-system/trade-paths-preview?entry=${entry}${extra}`,
    { waitUntil: "domcontentloaded" }
  );
  if (entry !== "friends")
    await page
      .getByRole("button", { name: "Open trade test", exact: true })
      .click();
  return { page, context };
}
const review = page =>
  page.getByRole("dialog", { name: "Review trade", exact: true });
const confirm = page =>
  page.getByRole("dialog", { name: "This can't be undone", exact: true });
async function accept(page) {
  await review(page)
    .getByRole("button", { name: "Accept", exact: true })
    .click();
  await confirm(page)
    .getByRole("button", { name: "Confirm trade", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector("[data-trade-test-events]")
      ?.textContent.includes("accept")
  );
  await review(page)
    .getByText("This trade was accepted. Here's what was exchanged.", {
      exact: true
    })
    .waitFor();
  assert.equal(
    await review(page)
      .getByRole("button", { name: "Accept", exact: true })
      .count(),
    0
  );
}
async function layout(page, label) {
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth,
    body: document.documentElement.scrollWidth,
    dialogs: [...document.querySelectorAll("dialog[open]")].map(d => {
      const r = d.getBoundingClientRect();
      return { x: r.x, right: r.right, width: r.width };
    })
  }));
  assert(
    dimensions.body <= dimensions.viewport + 1,
    `${label}: page overflow ${JSON.stringify(dimensions)}`
  );
  for (const d of dimensions.dialogs)
    assert(
      d.x >= -1 && d.right <= dimensions.viewport + 1,
      `${label}: dialog outside viewport ${JSON.stringify(d)}`
    );
  return dimensions;
}
try {
  for (const width of [320, 375, 768, 1024, 1440]) {
    const { page, context } = await fixture("targeted", "", width);
    await review(page)
      .getByRole("button", { name: "Accept", exact: true })
      .waitFor();
    const dimensions = await layout(page, String(width));
    if (width === 320 || width === 1440)
      await page.screenshot({
        path: resolve(directory, `review-${width}.png`)
      });
    await accept(page);
    results.push({
      scenario: "targeted-accept",
      width,
      dimensions,
      result: "passed"
    });
    await context.close();
  }
  for (const entry of ["notification", "fixed", "alias"]) {
    const { page, context } = await fixture(entry);
    if (entry !== "notification") {
      await page.getByRole("tab", { name: /Received/ }).click();
      await page
        .getByRole("button", { name: "Review trade", exact: true })
        .click();
    }
    await accept(page);
    results.push({ scenario: entry, result: "passed" });
    await context.close();
  }
  {
    const { page, context } = await fixture("friends", "&slow=1", 375);
    const button = page.getByRole("button", {
      name: "Trade with Trade Friend",
      exact: true
    });
    await button.waitFor();
    const started = performance.now();
    await button.click();
    await page.locator(".yk-private-trade-modal[open]").waitFor();
    const modalMs = Math.round(performance.now() - started);
    await page.locator(".yk-trade-composer").waitFor();
    const composerMs = Math.round(performance.now() - started);
    assert(
      modalMs < 1500 && composerMs < 1700,
      `route waits 1800ms and friends wait 5000ms: ${modalMs}/${composerMs}`
    );
    await layout(page, "friends-immediate");
    await page
      .locator(".yk-private-trade-modal[open] > div > button")
      .first()
      .click();
    assert.equal(
      await page.locator(".yk-private-trade-modal[open]").count(),
      0
    );
    results.push({
      scenario: "friends-immediate-open-close",
      modalMs,
      composerMs,
      routeDelayMs: 1800,
      friendLookupDelayMs: 5000,
      result: "passed"
    });
    await context.close();
  }
  {
    const { page, context } = await fixture("targeted");
    await review(page)
      .getByRole("button", { name: "Decline", exact: true })
      .click();
    await review(page)
      .getByText("This offer was declined.", { exact: true })
      .waitFor();
    results.push({ scenario: "decline", result: "passed" });
    await context.close();
  }
  {
    const { page, context } = await fixture("targeted");
    await review(page)
      .getByRole("button", { name: "Counteroffer", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Send counteroffer", exact: true })
      .click();
    await page.getByRole("tab", { name: /Sent/ }).waitFor();
    await page
      .getByRole("button", { name: "Cancel offer", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Cancel this offer?", exact: true })
      .getByRole("button", { name: "Cancel offer", exact: true })
      .click();
    await page.getByRole("tab", { name: "History", exact: true }).click();
    await page.getByText("Countered", { exact: true }).waitFor();
    await page.getByText("Canceled", { exact: true }).waitFor();
    results.push({
      scenario: "counteroffer-send-cancel-history",
      result: "passed"
    });
    await context.close();
  }
  for (const locale of ["en", "fr"]) {
    const { page, context } = await fixture(
      "targeted",
      "&failRefresh=1",
      375,
      locale
    );
    await accept(page);
    assert.equal(await page.locator("html").getAttribute("lang"), locale);
    const text = await review(page).innerText();
    assert(
      text.includes(
        locale === "fr" ? "L’échange a été mis à jour" : "The trade was updated"
      )
    );
    results.push({
      scenario: "accepted-refresh-failure",
      locale,
      result: "passed"
    });
    await context.close();
  }
  {
    const { page, context } = await fixture("targeted", "&reject=1");
    await review(page)
      .getByRole("button", { name: "Accept", exact: true })
      .click();
    await confirm(page)
      .getByRole("button", { name: "Confirm trade", exact: true })
      .click();
    await review(page)
      .getByText("This offer was canceled.", { exact: true })
      .waitFor();
    assert.equal(
      await review(page)
        .getByRole("button", { name: "Accept", exact: true })
        .count(),
      0
    );
    results.push({ scenario: "authoritative-rejection", result: "passed" });
    await context.close();
  }
  {
    const { page, context } = await fixture("targeted", "", 720, "en", 2);
    await review(page)
      .getByRole("button", { name: "Accept", exact: true })
      .waitFor();
    await layout(
      page,
      "200% layout emulation: 720 CSS pixels on 1440 physical pixels"
    );
    await accept(page);
    results.push({
      scenario: "200%-layout-emulation",
      nativeBrowserZoomVerified: false,
      result: "passed"
    });
    await context.close();
  }
  {
    const context = await browser.newContext({
      viewport: { width: 375, height: 900 }
    });
    await context.addCookies([
      { name: "yokkai_locale", value: "v1:manual:en:seen", url: origin }
    ]);
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(`${origin}/design-system/private-messages-preview`, {
      waitUntil: "domcontentloaded"
    });
    await page
      .getByRole("button", { name: "Message Kitsune", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Add sample trades", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Message Kitsune", exact: true })
      .click();
    const incoming = page.locator(
      '.yk-conversation-trade[aria-label="Received trade offer"]'
    );
    await incoming.getByRole("button", { name: "Accept", exact: true }).click();
    await incoming
      .getByRole("button", { name: "Confirm trade", exact: true })
      .click();
    await incoming.getByText("Accepted", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("yokkai:conversation-trades-preview:v1")
          ).filter(o => o.status === "accepted").length
      ),
      1
    );
    await layout(page, "messages-375");
    results.push({ scenario: "messages-accept", width: 375, result: "passed" });
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(
    resolve(directory, "results.json"),
    JSON.stringify(results, null, 2)
  );
  console.log(JSON.stringify(results));
}
