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
    `--user-data-dir=${await mkdtemp(join(tmpdir(), "yokkai-banner-crop-"))}`,
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
    for (let i = 0; i < 250; i++) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw Error(`Timed out: ${expression}`);
  };
  await send("Network.enable");
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Network.setBlockedURLs", { urls: ["https://*", "http://api.*"] });
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1100,
    deviceScaleFactor: 1,
    mobile: false
  });
  const run = fn => evaluate("(" + fn.toString() + ")()");
  const click = text =>
    evaluate(
      "Array.from(document.querySelectorAll('dialog[open] button')).find(b=>b.textContent.trim()===" +
        JSON.stringify(text) +
        ")?.click()"
    );
  const edit = () =>
    run(() =>
      Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent.trim() === "Modifier le profil")
        .click()
    );
  const cropReady = () =>
    until(
      "!!document.querySelector('.yk-banner-crop-actions button:last-child') && !document.querySelector('.yk-banner-crop-actions button:last-child').disabled"
    );
  const root = new URL("../artifacts/banner-crop/", import.meta.url);
  await mkdir(root, { recursive: true });
  const capture = async name => {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(new URL(name, root), Buffer.from(data, "base64"));
  };
  const stage = () =>
    run(() => {
      const r = document
        .querySelector(".yk-banner-crop-stage")
        .getBoundingClientRect();
      return {
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
        width: r.width,
        height: r.height
      };
    });
  const transform = () =>
    evaluate(
      "document.querySelector('.yk-banner-crop-stage img').style.transform"
    );
  await send("Page.navigate", {
    url: "http://localhost:3000/design-system/profile-preview?catalogue=demo"
  });
  await until("!!document.querySelector('.yk-profile-identity')");
  await edit();
  await until("!!document.querySelector('.yk-profile-banner-editor')");
  await click("Adjust banner");
  await cropReady();
  await capture("desktop-editor.png");
  const before = await transform(),
    box = await stage();
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: box.x,
    y: box.y,
    button: "left",
    clickCount: 1
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: box.x,
    y: box.y - 45,
    button: "left",
    buttons: 1
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: box.x,
    y: box.y - 45,
    button: "left",
    clickCount: 1
  });
  await delay(100);
  assert.notEqual(await transform(), before, "mouse drag");
  const keyboardBefore = await transform();
  await run(() => document.querySelector(".yk-banner-crop-stage").focus());
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "ArrowDown",
    code: "ArrowDown",
    windowsVirtualKeyCode: 40
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "ArrowDown",
    code: "ArrowDown",
    windowsVirtualKeyCode: 40
  });
  await delay(100);
  assert.notEqual(await transform(), keyboardBefore, "keyboard panning");
  await run(() => {
    const input = document.querySelector('input[aria-label="Banner zoom"]');
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    ).set.call(input, "1.6");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await until(
    "document.querySelector('.yk-banner-crop-zoom output').textContent==='160%'"
  );
  await click("Fit entire image");
  assert.match(await transform(), /scale\(1(?:\.0+)?\)/);
  for (const rotation of [90, 180, 270, 0]) {
    await click("Rotate 90°");
    await delay(50);
    assert.ok((await transform()).includes("rotate(" + rotation + "deg)"));
  }
  await click("Reset");
  await click("Rotate 90°");
  await delay(50);
  await capture("desktop-rotated.png");
  await click("Apply crop");
  await until("!document.querySelector('.yk-banner-crop-modal')");
  assert.ok(
    await evaluate("!!document.querySelector('.yk-banner-framed-preview')")
  );
  await click("Enregistrer");
  await until("!document.querySelector('.yk-profile-banner-editor')");
  await until(
    "document.querySelector('.yk-profile-banner.has-frame img')?.naturalHeight>0"
  );
  const saved = await evaluate(
    "document.querySelector('.yk-profile-banner.has-frame img').style.transform"
  );
  assert.match(saved, /rotate\(90deg\)/, "rotation is saved on the profile");
  await capture("desktop-profile.png");
  await edit();
  await until("!!document.querySelector('.yk-profile-banner-editor')");
  await click("Adjust banner");
  await cropReady();
  assert.equal(await transform(), saved, "restore saved crop");
  await click("Fit entire image");
  await click("Cancel");
  assert.equal(
    await evaluate(
      "document.querySelector('.yk-banner-framed-preview img').style.transform"
    ),
    saved,
    "cancel restores previous"
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true
  });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await click("Adjust banner");
  await cropReady();
  const touchBefore = await transform(),
    phone = await stage();
  await send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: phone.x, y: phone.y }]
  });
  await send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: phone.x, y: phone.y - 30 }]
  });
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await delay(100);
  assert.notEqual(await transform(), touchBefore, "touch drag");
  await capture("mobile-editor.png");
  assert.equal(
    await evaluate("document.documentElement.scrollWidth>innerWidth"),
    false
  );
  await click("Apply crop");
  await click("Enregistrer");
  await until("!document.querySelector('.yk-profile-banner-editor')");
  const phoneCrop = await evaluate(
    "document.querySelector('.yk-profile-banner.has-frame img').style.transform"
  );
  const ratio = await run(() => {
    const r = document
      .querySelector(".yk-profile-banner.has-frame")
      .getBoundingClientRect();
    return r.width / r.height;
  });
  assert.ok(Math.abs(ratio - 2.3) < 0.04);
  await send("Emulation.setDeviceMetricsOverride", {
    width: 3840,
    height: 1968,
    deviceScaleFactor: 1,
    mobile: false
  });
  assert.equal(
    await evaluate(
      "document.querySelector('.yk-profile-banner.has-frame img').style.transform"
    ),
    phoneCrop,
    "4K relative crop"
  );
  await capture("4k-profile.png");
  const file = async (type = "image/png", size = 0) => {
    await evaluate(
      "window.cropTestType=" +
        JSON.stringify(type) +
        ";window.cropTestSize=" +
        size
    );
    await run(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1000;
      canvas.height = 400;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#5b376e";
      ctx.fillRect(0, 0, 1000, 400);
      const blob = await new Promise(resolve =>
        canvas.toBlob(resolve, "image/png")
      );
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(
          window.cropTestSize ? [new Uint8Array(window.cropTestSize)] : [blob],
          "banner.png",
          { type: window.cropTestType }
        )
      );
      const input = document.querySelector(
        'input[aria-label="Importer une bannière"]'
      );
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };
  await edit();
  await until("!!document.querySelector('.yk-profile-banner-editor')");
  await file();
  await cropReady();
  await click("Cancel");
  assert.equal(
    await evaluate(
      "document.querySelector('.yk-banner-framed-preview img').getAttribute('src')"
    ),
    "/assets/landing/gojou.webp"
  );
  await file();
  await cropReady();
  await click("Apply crop");
  assert.ok(
    await evaluate(
      "document.querySelector('.yk-banner-framed-preview img').src.startsWith('blob:')"
    )
  );
  await click("Enregistrer");
  await until("!document.querySelector('.yk-profile-banner-editor')");
  assert.ok(
    await evaluate(
      "document.querySelector('.yk-profile-banner.has-frame img').src.startsWith('blob:')"
    )
  );
  await edit();
  await until("!!document.querySelector('.yk-profile-banner-editor')");
  await file("image/png", 4 * 1024 * 1024 + 1);
  await until(
    "document.querySelector('dialog[open] [role=alert]')?.textContent.includes('4 MB')"
  );
  assert.equal(
    await evaluate("!!document.querySelector('.yk-banner-crop-modal')"),
    false
  );
  await file("image/svg+xml");
  await until(
    "document.querySelector('dialog[open] [role=alert]')?.textContent.includes('JPG')"
  );
  assert.equal(
    await evaluate("!!document.querySelector('.yk-banner-crop-modal')"),
    false
  );
  await run(() => {
    const input = document.querySelector(
      'input[placeholder="Nom du personnage ou de la série…"]'
    );
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    ).set.call(input, "LEVI");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await until("!!document.querySelector('.yk-banner-results button')");
  await run(() => document.querySelector(".yk-banner-results button").click());
  await cropReady();
  assert.equal(
    await evaluate(
      "document.querySelector('.yk-banner-crop-stage img').getAttribute('src')"
    ),
    "/assets/landing/levi.webp"
  );
  await click("Apply crop");
  assert.equal(
    await evaluate(
      "document.querySelector('.yk-banner-framed-preview img').getAttribute('src')"
    ),
    "/assets/landing/levi.webp"
  );
  // A corrupt image stays cancellable and cannot be applied.
  await run(() => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["not an image"], "broken.gif", { type: "image/gif" })
    );
    const input = document.querySelector(
      'input[aria-label="Importer une bannière"]'
    );
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await until(
    "document.querySelector('.yk-banner-crop-state[role=alert]')?.textContent.includes(\"couldn't be loaded\")"
  );
  assert.equal(
    await evaluate(
      "document.querySelector('.yk-banner-crop-actions button:last-child').disabled"
    ),
    true
  );
  await click("Cancel");
  assert.equal(
    await evaluate(
      "document.querySelector('.yk-banner-framed-preview img').getAttribute('src')"
    ),
    "/assets/landing/levi.webp"
  );
  assert.ok(
    requests.every(url => url.endsWith("/get_profile")),
    JSON.stringify(requests)
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: mouse/touch pan, zoom, fit/reset, apply/cancel, saved/reopened crop, mobile/4K, imports and validation, no game writes."
  );
} finally {
  socket?.close();
  browser.kill();
}
