import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const browser = spawn(
  process.env.CHROME_PATH ??
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--remote-debugging-port=0",
    `--user-data-dir=${await mkdtemp(join(tmpdir(), "yokkai-callouts-"))}`,
    "about:blank"
  ],
  { stdio: ["ignore", "ignore", "pipe"], windowsHide: true }
);
let socket;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const endpoint = await new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(
      () => reject(Error("Chrome startup timed out")),
      15000
    );
    browser.on("error", reject);
    browser.stderr.on("data", data => {
      stderr += data;
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  const origin = new URL(endpoint);
  origin.protocol = "http:";
  origin.pathname = "/json/new";
  origin.search = "?about:blank";
  const target = await (await fetch(origin, { method: "PUT" })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve =>
    socket.addEventListener("open", resolve, { once: true })
  );
  const pending = new Map(),
    requests = [],
    errors = [];
  let id = 0;
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown")
      errors.push(message.params.exceptionDetails.text);
    if (
      message.method === "Network.requestWillBeSent" &&
      message.params.request.url.includes("/rpc/")
    )
      requests.push(message.params.request.url);
    const callback = pending.get(message.id);
    if (callback) {
      pending.delete(message.id);
      if (message.error) callback.reject(message.error);
      else callback.resolve(message.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const requestId = ++id;
      pending.set(requestId, { resolve, reject });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    assert.ok(
      !result.exceptionDetails,
      JSON.stringify(result.exceptionDetails)
    );
    return result.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 400; i++) {
      if (await evaluate(expression)) return;
      await delay(25);
    }
    throw Error(`Timed out: ${expression}`);
  };
  await send("Network.enable");
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Network.setBlockedURLs", { urls: ["https://*", "http://api.*"] });
  const root = new URL("../artifacts/reveal-callouts/", import.meta.url);
  await mkdir(root, { recursive: true });
  const viewport = (width, height) =>
    send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 700
    });
  const clickDeck = () =>
    evaluate("document.querySelector('.yk-deck-button').click()");
  const finishCard = async () => {
    await until(
      "document.querySelector('.yk-deck-button')?.getAttribute('aria-disabled')==='false'"
    );
    await clickDeck();
  };
  const measure = async (rarity, shiny) => {
    await evaluate(
      "document.getAnimations().forEach(a=>{const timing=a.effect?.getTiming();if(Number.isFinite(timing?.iterations))a.finish();})"
    );
    for (const [width, height] of [
      [1440, 1000],
      [390, 844],
      [1280, 360]
    ]) {
      await viewport(width, height);
      await delay(40);
      const layout = await evaluate(
        "(()=>{const stage=document.querySelector('.yk-reveal-stage');const title=stage.querySelector('.yk-callout').getBoundingClientRect();const card=stage.querySelector('.yk-flip-front .yk-card').getBoundingClientRect();const shiny=stage.querySelector('.yk-shiny-callout')?.getBoundingClientRect();return {title:{top:title.top,bottom:title.bottom,center:title.x+title.width/2},card:{top:card.top,center:card.x+card.width/2},shiny:shiny?{top:shiny.top,bottom:shiny.bottom}:null};})()"
      );
      const context = JSON.stringify({
        rarity,
        shiny,
        width,
        height,
        ...layout
      });
      assert.ok(layout.title.top >= 0, context);
      assert.ok(
        Math.abs(layout.title.center - layout.card.center) < 4,
        context
      );
      const lastLine = shiny ? layout.shiny : layout.title;
      if (shiny) assert.ok(layout.title.bottom <= layout.shiny.top, context);
      assert.ok(lastLine.bottom <= layout.card.top, context);
      assert.ok(layout.card.top - lastLine.bottom < 75, context);
      if (width === 1440 || width === 390) {
        const { data } = await send("Page.captureScreenshot", {
          format: "png"
        });
        await writeFile(
          new URL(`${rarity}${shiny ? "-shiny" : ""}-${width}.png`, root),
          Buffer.from(data, "base64")
        );
      }
    }
    await viewport(1440, 1000);
  };
  for (const kind of ["regular", "decision"]) {
    await viewport(1440, 1000);
    await evaluate("window.__proofNavigationPending=true");
    await send("Page.navigate", {
      url:
        (process.env.PREVIEW_ORIGIN ?? "http://localhost:3000") +
        "/design-system/boosters-preview"
    });
    await until(
      "!window.__proofNavigationPending && document.querySelectorAll('.yk-pack-panel').length===2"
    );
    await until(
      "Array.from(document.querySelectorAll('.yk-pack-body > button')).every(b=>Object.entries(b).some(([k,v])=>k.startsWith('__reactProps')&&typeof v.onClick==='function'))"
    );
    await delay(1500);
    await evaluate(
      `document.querySelector('${kind === "decision" ? ".yk-decision-panel" : ".yk-pack-panel:not(.yk-decision-panel)"} .yk-pack-body > button').click()`
    );
    await until("!!document.querySelector('.yk-opening-seal')");
    await evaluate("document.querySelector('.yk-opening-seal').click()");
    await until("!!document.querySelector('.yk-deck-button')");
    for (let i = 0; i < 3; i++) {
      await clickDeck();
      await finishCard();
    }
    await clickDeck();
    await until("!!document.querySelector('.yk-reveal-ssr')");
    await measure("SSR", kind === "decision");
    if (kind === "regular") {
      await finishCard();
      await clickDeck();
      await until("!!document.querySelector('.yk-reveal-lr')");
      await measure("LR", false);
    }
  }
  assert.ok(
    requests.every(url => url.endsWith("/get_profile")),
    JSON.stringify(requests)
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: actual SSR, LR and simulated SSR Shiny callouts stay close to their card, centered, separated and on-screen on desktop/mobile/short landscape; no real pack writes."
  );
} finally {
  socket?.close();
  browser.kill();
}
