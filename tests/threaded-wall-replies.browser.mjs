import fs from "node:fs";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true
});
const results = [];
try {
  for (const compact of [false, true])
    for (const locale of ["en", "fr"])
      for (const target of [
        { w: 320, z: 1 },
        { w: 375, z: 1 },
        { w: 768, z: 1 },
        { w: 1024, z: 1 },
        { w: 1440, z: 1 },
        { w: 1024, z: 2 },
        { w: 1440, z: 2 }
      ]) {
        const page = await browser.newPage({
          viewport: {
            width: Math.round(target.w / target.z),
            height: Math.round(1000 / target.z)
          },
          deviceScaleFactor: target.z
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
          `${process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3013"}/design-system/threaded-replies-preview?compact=${compact}`
        );
        await page.locator(".yk-post-actions > button").nth(1).click();
        const parent = page.locator('[data-wall-reply="reply-parent"]');
        const replyName = locale === "fr" ? "Répondre" : "Reply";
        await parent
          .getByRole("button", { name: replyName, exact: true })
          .click();
        const form = page.locator("form");
        assert((await form.locator("label").innerText()).includes("Kitsune"));
        assert.equal(
          await form.evaluate(
            e => e.parentElement.querySelector("article")?.dataset.wallReply
          ),
          "reply-parent"
        );
        await form.locator("textarea").fill("A nested test reply");
        await form
          .getByRole("button", {
            name: locale === "fr" ? "Envoyer la réponse" : "Send reply",
            exact: true
          })
          .click();
        const posted = page.locator("article").filter({
          has: page.getByText("A nested test reply", { exact: true })
        });
        await posted.waitFor();
        assert.equal(
          await posted.locator(".yk-reply-parent-label").innerText(),
          locale === "fr" ? "En réponse à Kitsune" : "Replying to Kitsune"
        );
        const ids = await page
          .locator("[data-wall-reply]")
          .evaluateAll(es => es.map(e => e.dataset.wallReply));
        assert(ids.indexOf("reply-child") > ids.indexOf("reply-parent"));
        assert(ids.indexOf("reply-deep") > ids.indexOf("reply-child"));
        await posted
          .getByRole("button", { name: replyName, exact: true })
          .click();
        await form.locator("textarea").fill("Keep this draft");
        await form
          .getByRole("button", {
            name: locale === "fr" ? "Annuler la réponse" : "Cancel reply",
            exact: true
          })
          .click();
        assert.equal(
          await form.locator("textarea").inputValue(),
          "Keep this draft"
        );
        assert.equal(
          await form.evaluate(e => e.parentElement.className),
          "yk-post-thread"
        );
        const geometry = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          articles: [...document.querySelectorAll("[data-wall-reply]")].map(
            e => {
              const r = e.getBoundingClientRect();
              return { left: r.left, right: r.right };
            }
          )
        }));
        assert(!geometry.overflow);
        assert(
          geometry.articles.every(
            r => r.left >= 0 && r.right <= Math.round(target.w / target.z) + 1
          )
        );
        assert.deepEqual(errors, []);

        results.push({
          locale,
          width: target.w,
          zoom: target.z,
          compact,
          passed: true
        });
        if (process.env.RESPONSIVE_EVIDENCE_PATH)
          fs.writeFileSync(
            process.env.RESPONSIVE_EVIDENCE_PATH,
            JSON.stringify(results, null, 2)
          );
        console.log(JSON.stringify(results.at(-1)));
        await page.close();
      }
} finally {
  await browser.close();
}
