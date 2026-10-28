// #394: no horizontal page overflow on Auth pages. Runs in CI after `next build`
// against `next start` (CHROME_PATH overrides the system Chrome locally).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";

const port = 3107;
const origin = `http://127.0.0.1:${port}`;
const widths = [320, 375, 768, 1440];
const routes = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/login?confirmation=erreur"
];
// The pre-fix decoration: absolutely positioned halos with negative offsets on
// an unclipped shell. The measurement must catch it, or it proves nothing.
const regression = `.yk-auth-shell{overflow:visible!important;contain:none!important}
.yk-auth-shell::before,.yk-auth-shell::after{position:absolute;content:"";aspect-ratio:1}
.yk-auth-shell::before{width:min(62vw,760px);top:-42%;left:-18%}
.yk-auth-shell::after{width:min(48vw,620px);right:-16%;bottom:-38%}`;

const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "-p",
    String(port),
    "-H",
    "127.0.0.1"
  ],
  { stdio: ["ignore", "inherit", "inherit"] }
);
let browser;
try {
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${origin}/login`)).ok) break;
    } catch {}
    assert.ok(i < 60, "next start did not answer within 60 s");
    await delay(1000);
  }
  browser = await chromium.launch(
    process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : { channel: "chrome" }
  );
  const measure = async (width, route, css) => {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    // Showcase images come from production Storage: never leave the machine.
    await page.route(
      url => !url.href.startsWith(origin),
      request => request.abort()
    );
    const response = await page.goto(origin + route, { waitUntil: "load" });
    assert.equal(response.status(), 200, `${route} at ${width}px`);
    if (css) await page.addStyleTag({ content: css });
    // Let the entry transition settle before measuring the resting layout.
    await page.waitForTimeout(600);
    const size = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    await page.close();
    return size;
  };
  for (const width of widths)
    for (const route of routes) {
      const { scrollWidth, clientWidth } = await measure(width, route);
      assert.ok(
        scrollWidth <= clientWidth,
        `${route} overflows at ${width}px: scrollWidth ${scrollWidth} > clientWidth ${clientWidth}`
      );
      console.log(`${route} at ${width}px: ${scrollWidth} <= ${clientWidth}`);
    }
  for (const width of widths) {
    const { scrollWidth, clientWidth } = await measure(
      width,
      "/login",
      regression
    );
    assert.ok(
      scrollWidth > clientWidth,
      `counterproof: the pre-fix halos must overflow at ${width}px`
    );
    console.log(
      `counterproof at ${width}px: pre-fix halos overflow (${scrollWidth} > ${clientWidth})`
    );
  }
} finally {
  await browser?.close();
  server.kill();
}
