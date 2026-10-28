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
    `--user-data-dir=${await mkdtemp(join(tmpdir(), "yokkai-native-drop-"))}`,
    "about:blank"
  ],
  { stdio: ["ignore", "ignore", "pipe"], windowsHide: true }
);
let socket;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const endpoint = await new Promise((resolve, reject) => {
    let stderr = "";
    const timeout = setTimeout(
      () => reject(Error("Chrome startup timed out")),
      15000
    );
    browser.on("error", reject);
    browser.stderr.on("data", data => {
      stderr += data;
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timeout);
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
      message.error
        ? callback.reject(message.error)
        : callback.resolve(message.result);
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
    for (let i = 0; i < 250; i++) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw Error(`Timed out: ${expression}`);
  };
  const clickText = text =>
    evaluate(
      `Array.from(document.querySelectorAll('dialog[open] button')).find(b=>b.textContent.trim()===${JSON.stringify(text)})?.click()`
    );
  await send("Network.enable");
  await send("Runtime.enable");
  await send("Page.enable");
  const mediaRequests = [];
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (
      message.method === "Network.requestWillBeSent" &&
      /\\.(mp4|webm)(?:[?#]|$)/i.test(message.params.request.url)
    )
      mediaRequests.push(message.params.request.url);
  });
  await send("Network.setBlockedURLs", { urls: ["https://*", "http://api.*"] });
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false
  });
  await send("Page.navigate", {
    url: "http://localhost:3000/design-system/boosters-preview"
  });
  await until("document.querySelectorAll('.yk-pack-panel').length===2");
  await delay(1500);
  await mkdir(new URL("../artifacts/boosters-showcase/", import.meta.url), {
    recursive: true
  });
  for (const width of [1440, 768, 390]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: width < 700
    });
    await delay(100);
    const layout = await evaluate(
      "(()=>{const panels=[...document.querySelectorAll('.yk-pack-panel')].map(p=>{const r=p.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,bottom:r.bottom};});return {overflow:document.documentElement.scrollWidth>innerWidth,panels};})()"
    );
    assert.equal(layout.overflow, false, JSON.stringify(layout));
    assert.equal(layout.panels.length, 2);
    if (width > 700) {
      assert.equal(layout.panels[0].y, layout.panels[1].y);
      assert.equal(layout.panels[0].bottom, layout.panels[1].bottom);
    } else assert.ok(layout.panels[1].y >= layout.panels[0].bottom);
    const { data } = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true
    });
    await writeFile(
      new URL(`../artifacts/boosters-showcase/${width}.png`, import.meta.url),
      Buffer.from(data, "base64")
    );
  }
  await evaluate("document.querySelector('.yk-pack-info').click()");
  await until("!!document.querySelector('dialog[open]')");
  await evaluate(
    "document.querySelector('dialog[open] button[aria-label=Close]').click()"
  );
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }]
  });
  assert.equal(
    await evaluate(
      "getComputedStyle(document.querySelector('.yk-pack-image')).animationName"
    ),
    "none"
  );
  assert.equal(
    await evaluate(
      "!!document.querySelector('.yk-decision-panel .yk-pack-body > button:not(:disabled)')"
    ),
    true
  );
  assert.ok(
    requests.every(url => url.endsWith("/get_profile")),
    JSON.stringify(requests)
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: showcase desktop/tablet/mobile, no overflow, aligned panels, rates dialog, available decision, reduced motion, no pack mutation."
  );
} finally {
  socket?.close();
  browser.kill();
}
