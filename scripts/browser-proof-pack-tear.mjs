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
    `--user-data-dir=${await mkdtemp(join(tmpdir(), "yokkai-pack-tear-"))}`,
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
      errors.push(message.params.exceptionDetails);
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
    throw Error(
      `Timed out: ${expression}; diagnostics: ${JSON.stringify(await evaluate("({ready:document.readyState,text:document.body.innerText.slice(-3000),buttons:Array.from(document.querySelectorAll('.yk-pack-body > button'),b=>({text:b.innerText,disabled:b.disabled,hydrated:Object.keys(b).some(k=>k.startsWith('__reactProps'))}))})"))}; errors: ${JSON.stringify(errors)}`
    );
  };
  await send("Network.enable");
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Network.setBlockedURLs", { urls: ["https://*", "http://api.*"] });
  const root = new URL("../artifacts/pack-tear/", import.meta.url);
  await mkdir(root, { recursive: true });
  const capture = async name => {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(new URL(name, root), Buffer.from(data, "base64"));
  };
  const navigate = async (width, reduced = false) => {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: width < 700 ? 844 : 1000,
      deviceScaleFactor: 1,
      mobile: width < 700
    });
    await send("Emulation.setEmulatedMedia", {
      features: [
        {
          name: "prefers-reduced-motion",
          value: reduced ? "reduce" : "no-preference"
        }
      ]
    });
    await evaluate("window.__proofNavigationPending=true");
    await send("Page.navigate", {
      url:
        (process.env.PREVIEW_ORIGIN ?? "http://localhost:3000") +
        "/design-system/boosters-preview"
    });
    await until(
      "!window.__proofNavigationPending && document.querySelectorAll('.yk-pack-panel').length===2"
    );
    await evaluate(
      "Promise.all(Array.from(document.querySelectorAll('.yk-pack-image'),img=>img.decode().catch(()=>{})))"
    );
    await evaluate(
      "document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))"
    );
    await until(
      "Array.from(document.querySelectorAll('.yk-pack-body > button')).every(b=>Object.entries(b).some(([k,v])=>k.startsWith('__reactProps')&&typeof v.onClick==='function'))"
    );
    await delay(1500);
    const layout = await evaluate(
      "({width:innerWidth,scroll:document.documentElement.scrollWidth})"
    );
    assert.ok(
      layout.scroll <= layout.width,
      JSON.stringify({ viewport: width, ...layout })
    );
  };
  for (const width of [1440, 390]) {
    for (const kind of ["regular", "decision"]) {
      await navigate(width);
      if (kind === "decision") {
        const palette = await evaluate(
          "(()=>{const panel=document.querySelector('.yk-decision-panel');const style=getComputedStyle(panel);return {accent:style.getPropertyValue('--pack-accent').trim(),text:style.color,background:style.backgroundImage};})()"
        );
        assert.equal(palette.accent, "#c0c5ff");
        assert.equal(palette.text, "rgb(238, 235, 255)");
        assert.ok(palette.background.includes("rgb(27, 29, 53)"));
        if (width < 700)
          await evaluate(
            "document.querySelector('.yk-decision-panel').scrollIntoView({block:'center',behavior:'instant'})"
          );
        await capture(`selection-${width}.png`);
      }
      await evaluate(
        `document.querySelector('${kind === "decision" ? ".yk-decision-panel" : ".yk-pack-panel:not(.yk-decision-panel)"} .yk-pack-body > button').click()`
      );
      await until(
        "!!document.querySelector('.yk-opening-seal .yk-pack-tear-top')"
      );
      const state = await evaluate(
        "(()=>{const part=document.querySelector('.yk-pack-tear-top');const body=document.querySelector('.yk-pack-tear-body');return {top:part.getAttribute('src'),body:body.getAttribute('src'),animation:getComputedStyle(part).animationName,loop:getComputedStyle(part).animationIterationCount,sparks:document.querySelectorAll('.yk-pack-tear-spark').length,bodyAnimation:getComputedStyle(body).animationName};})()"
      );
      assert.equal(
        state.top,
        kind === "decision"
          ? "/assets/decision-booster-pack.png"
          : "/assets/booster-pack.png"
      );
      assert.equal(state.body, state.top);
      assert.equal(state.animation, "yk-pack-tear-strip");
      assert.equal(state.loop, "1");
      assert.equal(state.sparks, 16);
      assert.equal(state.bodyAnimation, "none");
      await evaluate(
        "document.getAnimations().forEach(a=>{if(a.animationName==='yk-pack-tear-strip'){a.pause();a.currentTime=480;}})"
      );
      await capture(`${kind}-tear-${width}.png`);
      await until("!!document.querySelector('.yk-reveal-screen')");
      assert.equal(
        await evaluate("document.querySelectorAll('video,iframe').length"),
        0
      );
      assert.equal(
        await evaluate("document.documentElement.scrollWidth>innerWidth"),
        false
      );
      assert.equal(
        await evaluate("document.querySelectorAll('.yk-opening-stage').length"),
        0
      );
    }
  }
  await navigate(390, true);
  await evaluate(
    "document.querySelector('.yk-pack-panel .yk-pack-body > button').click()"
  );
  await until("!!document.querySelector('.yk-reveal-screen')");
  assert.equal(
    await evaluate("document.querySelectorAll('.yk-opening-stage').length"),
    0
  );
  assert.equal(
    await evaluate("!!document.activeElement?.closest('.yk-reveal-screen')"),
    true
  );
  assert.ok(
    requests.every(url => url.endsWith("/get_profile")),
    JSON.stringify(requests)
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: shared dark theme; native tear for both packs on desktop/mobile; 16 gold sparks; one-shot top, stationary body; reveal and reduced motion; no real pack writes."
  );
} finally {
  socket?.close();
  browser.kill();
}
