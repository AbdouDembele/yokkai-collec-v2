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
    `--user-data-dir=${await mkdtemp(join(tmpdir(), "yokkai-profile-editors-"))}`,
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
      "Array.from(Array.from(document.querySelectorAll('dialog[open]')).at(-1).querySelectorAll('button')).find(b=>b.textContent.trim()===" +
        JSON.stringify(text) +
        ")?.click()"
    );
  const edit = () =>
    run(() =>
      Array.from(document.querySelectorAll(".yk-profile-actions button"))
        .find(b => b.textContent.trim() === "Edit profile")
        .click()
    );
  const input = value =>
    evaluate(
      "(()=>{const i=document.querySelector('[data-owned-banner-picker] input[type=search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i," +
        JSON.stringify(value) +
        ");i.dispatchEvent(new Event('input',{bubbles:true}));})()"
    );
  const root = new URL("../artifacts/owned-card-banners/", import.meta.url);
  await mkdir(root, { recursive: true });
  const capture = async name => {
    const { data } = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true
    });
    await writeFile(new URL(name, root), Buffer.from(data, "base64"));
  };
  const navigate = async query => {
    await send("Page.navigate", {
      url:
        "http://localhost:3000/design-system/profile-preview?catalogue=demo" +
        query
    });
    await until("!!document.querySelector('.yk-profile-showcase')");
  };
  const chooseLevi = async () => {
    await input("LEVI");
    await until(
      "document.querySelectorAll('[data-owned-banner-picker] .yk-banner-results button').length===1"
    );
    await run(() =>
      document
        .querySelector("[data-owned-banner-picker] .yk-banner-results button")
        .click()
    );
    await until(
      "!!document.querySelector('.yk-banner-crop-stage img')?.naturalWidth"
    );
    await until(
      "Array.from(document.querySelectorAll('.yk-banner-crop-actions button')).some(b=>b.textContent.trim()==='Apply crop'&&!b.disabled)"
    );
  };
  await navigate("&bannerCards=duplicates");
  await edit();
  await until("!!document.querySelector('[data-owned-banner-picker]')");
  assert.equal(
    await evaluate(
      "document.querySelectorAll('[data-profile-editor] input[type=file]').length"
    ),
    1,
    "avatar only"
  );
  assert.equal(
    await evaluate(
      "document.querySelectorAll('[data-owned-banner-picker] input[type=file]').length"
    ),
    0
  );
  assert.equal(
    await evaluate(
      "document.querySelectorAll('[data-owned-banner-picker] .yk-banner-results button').length"
    ),
    3,
    "duplicate copies have one choice"
  );
  assert.deepEqual(
    await evaluate(
      "Array.from(document.querySelectorAll('[data-owned-banner-picker] .yk-banner-results button strong'),n=>n.textContent)"
    ),
    ["SATORU GOJO", "LEVI ACKERMAN", "MONKEY D. LUFFY"],
    "LR precedes SSR, with alphabetical order within SSR"
  );
  await input("NARUTO");
  await until(
    "document.querySelector('[data-owned-banner-picker]').textContent.includes('No matching cards')"
  );
  assert.equal(
    await evaluate(
      "document.querySelectorAll('[data-owned-banner-picker] .yk-banner-results button').length"
    ),
    0,
    "no catalogue fallback"
  );
  await chooseLevi();
  await click("Rotate 90°");
  await until(
    "document.querySelector('.yk-banner-crop-stage img').style.transform.includes('rotate(90deg)')"
  );
  await click("Fit entire image");
  await click("Apply crop");
  await until("!document.querySelector('.yk-banner-crop-stage')");
  assert.equal(
    await evaluate(
      "document.querySelector('.yk-banner-choice strong').textContent"
    ),
    "LEVI ACKERMAN"
  );
  assert.ok(
    (
      await evaluate("document.querySelector('.yk-profile-banner img').src")
    ).includes("gojou"),
    "crop remains a draft"
  );
  await click("Cancel");
  await until("!document.querySelector('[data-profile-editor]')");
  assert.ok(
    (
      await evaluate("document.querySelector('.yk-profile-banner img').src")
    ).includes("gojou"),
    "cancel preserves saved banner"
  );
  await edit();
  await until("!!document.querySelector('[data-owned-banner-picker]')");
  await chooseLevi();
  await click("Rotate 90°");
  await click("Fit entire image");
  await click("Apply crop");
  await until("!document.querySelector('.yk-banner-crop-stage')");
  await click("Save");
  await until("!document.querySelector('[data-profile-editor]')");
  await until(
    "document.querySelector('.yk-profile-banner img')?.style.transform.includes('rotate(90deg)')"
  );
  assert.ok(
    (
      await evaluate("document.querySelector('.yk-profile-banner img').src")
    ).includes("levi")
  );
  assert.equal(
    await evaluate(
      "document.querySelectorAll('.yk-profile-showcase .yk-card').length"
    ),
    3,
    "showcase remains unchanged"
  );
  await edit();
  await until("!!document.querySelector('[data-owned-banner-picker]')");
  await click("Adjust banner");
  await until(
    "!!document.querySelector('.yk-banner-crop-stage img')?.naturalWidth"
  );
  assert.ok(
    (
      await evaluate(
        "document.querySelector('.yk-banner-crop-stage img').style.transform"
      )
    ).includes("rotate(90deg)"),
    "rotation persisted"
  );
  await click("Cancel");
  await until("!document.querySelector('.yk-banner-crop-stage')");
  await capture("desktop-editor.png");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true
  });
  assert.equal(
    await evaluate("document.documentElement.scrollWidth>innerWidth"),
    false
  );
  assert.equal(
    await evaluate(
      "document.querySelector('dialog[open]').scrollWidth>document.querySelector('dialog[open]').clientWidth"
    ),
    false
  );
  await capture("mobile-editor.png");
  await click("Remove banner");
  await click("Save");
  await until("!document.querySelector('[data-profile-editor]')");
  assert.equal(
    await evaluate(
      "document.querySelectorAll('.yk-profile-banner img').length"
    ),
    0,
    "remove clears crop and image"
  );
  await navigate("&bannerCards=empty");
  await edit();
  await until("!!document.querySelector('[data-owned-banner-picker]')");
  assert.equal(
    await evaluate(
      "document.querySelectorAll('[data-owned-banner-picker] .yk-banner-results button').length"
    ),
    0
  );
  assert.ok(
    await evaluate(
      "document.querySelector('[data-owned-banner-picker]').textContent.includes('Collect a card')"
    )
  );
  await click("Save");
  await until("!document.querySelector('[data-profile-editor]')");
  assert.equal(
    await evaluate(
      "document.querySelectorAll('.yk-profile-banner img').length"
    ),
    0,
    "unowned legacy selection cannot be saved"
  );
  assert.ok(
    requests.every(url => url.endsWith("/get_profile")),
    JSON.stringify(requests)
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: owned-only deduplicated choices; local search without catalogue fallback; avatar-only upload; crop/rotation, cancel/save/remove; showcase preserved; empty collection and mobile; no game writes."
  );
} finally {
  socket?.close();
  browser.kill();
}
