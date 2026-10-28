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
    url: "http://127.0.0.1:3000/design-system/boosters-preview"
  });
  await until("document.querySelectorAll('.yk-pack-panel').length===2");
  await evaluate("document.fonts.ready.then(()=>true)");
  await delay(1200);
  await mkdir(new URL("../artifacts/boosters-viewport/", import.meta.url), {
    recursive: true
  });
  const sizes = [
    [1920, 911],
    [1536, 745],
    [1366, 648],
    [1280, 648],
    [1024, 768],
    [1440, 1050],
    [1920, 1201],
    [3840, 1968],
    [390, 844]
  ];
  for (const [width, height] of sizes) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 700
    });
    await evaluate("window.scrollTo(0,0)");
    await delay(120);
    const layout = await evaluate(
      "(()=>{const panels=[...document.querySelectorAll('.yk-pack-panel')].map(e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width};});const buttons=[...document.querySelectorAll('.yk-pack-body > button')].map(e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,display:getComputedStyle(e).display};});return{width:innerWidth,height:innerHeight,pageHeight:document.documentElement.scrollHeight,pageWidth:document.documentElement.scrollWidth,footerBottom:document.querySelector('footer').getBoundingClientRect().bottom,panels,buttons};})()"
    );
    console.log(JSON.stringify(layout));
    assert.ok(layout.pageWidth <= width, JSON.stringify(layout));
    assert.equal(layout.buttons.length, 2);
    for (const button of layout.buttons) {
      assert.ok(button.height >= 44);
      assert.notEqual(button.display, "none");
    }
    if (width > 700) {
      assert.ok(layout.pageHeight <= height + 1, JSON.stringify(layout));
      assert.ok(layout.footerBottom <= height + 1);
      assert.equal(layout.panels[0].top, layout.panels[1].top);
      for (const button of layout.buttons) assert.ok(button.bottom <= height);
    } else {
      assert.ok(layout.pageHeight > height, "mobile retains normal scrolling");
      assert.ok(layout.panels[1].top >= layout.panels[0].bottom);
    }
    const { data } = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: width < 700
    });
    await writeFile(
      new URL(
        `../artifacts/boosters-viewport/${width}x${height}.png`,
        import.meta.url
      ),
      Buffer.from(data, "base64")
    );
  }
  assert.ok(
    requests.every(url => url.endsWith("/get_profile")),
    JSON.stringify(requests)
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: all desktop pack selection + buttons + footer visible without scrolling; mobile readable and scrollable; no pack mutation."
  );
} finally {
  socket?.close();
  browser.kill();
}
