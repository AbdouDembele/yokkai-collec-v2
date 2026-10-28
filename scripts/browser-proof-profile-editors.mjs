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
      "Array.from(document.querySelectorAll('dialog[open] button')).find(b=>b.textContent.trim()===" +
        JSON.stringify(text) +
        ")?.click()"
    );
  const edit = () =>
    run(() =>
      Array.from(document.querySelectorAll(".yk-profile-actions button"))
        .find(b => b.textContent.trim() === "Modifier le profil")
        .click()
    );
  const showcase = () =>
    run(() =>
      document
        .querySelector(
          ".yk-profile-showcase .yk-profile-section-heading button"
        )
        .click()
    );
  const featured = () =>
    evaluate(
      "document.querySelectorAll('.yk-profile-showcase .yk-card').length"
    );
  const root = new URL("../artifacts/profile-editors/", import.meta.url);
  await mkdir(root, { recursive: true });
  const capture = async name => {
    const { data } = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true
    });
    await writeFile(new URL(name, root), Buffer.from(data, "base64"));
  };
  await send("Page.navigate", {
    url: "http://localhost:3000/design-system/profile-preview?catalogue=demo"
  });
  await until(
    "!!document.querySelector('.yk-profile-showcase .yk-profile-section-heading button')"
  );
  const appearance = await run(() => {
    const button = document.querySelector(
      ".yk-profile-showcase .yk-profile-section-heading button"
    );
    const profile = document.querySelector(".yk-profile-actions button");
    const a = getComputedStyle(button),
      b = getComputedStyle(profile);
    return {
      text: button.textContent.trim(),
      sameClasses: button.className === profile.className,
      sameBorder: a.border === b.border,
      sameBackground: a.background === b.background,
      sameFont: a.fontSize === b.fontSize
    };
  });
  assert.equal(appearance.text, "Edit showcase");
  assert.ok(
    appearance.sameClasses &&
      appearance.sameBorder &&
      appearance.sameBackground &&
      appearance.sameFont,
    JSON.stringify(appearance)
  );
  await edit();
  await until("!!document.querySelector('[data-profile-editor=profile]')");
  assert.equal(
    await evaluate(
      "!!document.querySelector('dialog[open] .yk-featured-picker')"
    ),
    false
  );
  assert.ok(
    await evaluate("!!document.querySelector('dialog[open] textarea')")
  );
  assert.ok(
    await evaluate(
      "!!document.querySelector('dialog[open] .yk-profile-banner-editor')"
    )
  );
  await run(() => {
    const bio = document.querySelector("dialog[open] textarea");
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    ).set.call(bio, "Showcase separation bio");
    bio.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const bioBox = await run(() => {
    const bio = document.querySelector("dialog[open] textarea");
    const box = bio.getBoundingClientRect();
    return {
      x: box.right - 3,
      y: box.bottom - 3,
      height: bio.offsetHeight,
      resize: getComputedStyle(bio).resize,
      overflow: getComputedStyle(bio).overflowY
    };
  });
  assert.equal(bioBox.resize, "none");
  assert.equal(bioBox.overflow, "auto");
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: bioBox.x,
    y: bioBox.y,
    button: "left",
    clickCount: 1
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: bioBox.x,
    y: bioBox.y + 100,
    button: "left",
    buttons: 1
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: bioBox.x,
    y: bioBox.y + 100,
    button: "left",
    clickCount: 1
  });
  assert.equal(
    await evaluate(
      "document.querySelector('dialog[open] textarea').offsetHeight"
    ),
    bioBox.height,
    "dragging the bio corner cannot change its height"
  );
  await click("Enregistrer");
  await until("!document.querySelector('[data-profile-editor]')");
  const bio = await evaluate(
    "document.querySelector('.yk-profile-bio').textContent"
  );
  assert.equal(bio, "Showcase separation bio");
  const originalCount = await featured();
  assert.equal(originalCount, 3);
  const originalBanner = await evaluate(
    "document.querySelector('.yk-profile-identity .yk-profile-banner img').src"
  );
  await showcase();
  await until(
    "!!document.querySelector('[data-profile-editor=showcase] .yk-featured-picker')"
  );
  assert.equal(
    await evaluate(
      "document.querySelectorAll('dialog[open] textarea,dialog[open] input[type=file],dialog[open] .yk-profile-banner-editor').length"
    ),
    0
  );
  await run(() =>
    document
      .querySelector(".yk-featured-picker button[aria-pressed=true]")
      .click()
  );
  await click("Annuler");
  await until("!document.querySelector('[data-profile-editor]')");
  assert.equal(
    await featured(),
    originalCount,
    "cancel preserves the showcase"
  );
  await showcase();
  await until("!!document.querySelector('[data-profile-editor=showcase]')");
  assert.equal(
    await evaluate(
      "document.querySelectorAll('.yk-featured-picker button[aria-pressed=true]').length"
    ),
    originalCount
  );
  await run(() => {
    const query = document.querySelector("#featured-query");
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    ).set.call(query, "LEVI");
    query.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await until(
    "document.querySelectorAll('.yk-featured-picker button').length===1"
  );
  await run(() => document.querySelector(".yk-featured-picker button").click());
  await click("Enregistrer");
  await until("!document.querySelector('[data-profile-editor]')");
  assert.equal(await featured(), originalCount - 1);
  assert.equal(
    await evaluate("document.querySelector('.yk-profile-bio').textContent"),
    bio,
    "showcase save preserves bio"
  );
  assert.equal(
    await evaluate(
      "document.querySelector('.yk-profile-identity .yk-profile-banner img').src"
    ),
    originalBanner,
    "showcase save preserves banner"
  );
  await edit();
  await until("!!document.querySelector('[data-profile-editor=profile]')");
  await click("Enregistrer");
  await until("!document.querySelector('[data-profile-editor]')");
  assert.equal(
    await featured(),
    originalCount - 1,
    "profile save preserves the current showcase"
  );
  await capture("desktop.png");
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
  await showcase();
  await until("!!document.querySelector('[data-profile-editor=showcase]')");
  assert.equal(
    await evaluate(
      "document.querySelector('dialog[open]').scrollWidth>document.querySelector('dialog[open]').clientWidth"
    ),
    false
  );
  await capture("mobile.png");
  await click("Annuler");
  await send("Page.navigate", {
    url: "http://localhost:3000/design-system/profile-preview?catalogue=demo&visitor=1"
  });
  await until("!!document.querySelector('.yk-profile-showcase')");
  assert.equal(
    await evaluate(
      "document.querySelectorAll('.yk-profile-showcase .yk-profile-section-heading button').length"
    ),
    0
  );
  assert.equal(
    await evaluate(
      "Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Edit showcase')"
    ),
    false
  );
  assert.ok(
    requests.every(url => url.endsWith("/get_profile")),
    JSON.stringify(requests)
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: owner-only header button matches profile button; profile/showcase fields separated; cancel, search, saves preserve other fields; mobile; no game writes."
  );
} finally {
  socket?.close();
  browser.kill();
}
