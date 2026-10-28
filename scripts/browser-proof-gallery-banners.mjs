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
  const root = new URL("../artifacts/gallery-banners/", import.meta.url);
  await mkdir(root, { recursive: true });
  const click = text =>
    evaluate(
      "Array.from(Array.from(document.querySelectorAll('dialog[open]')).at(-1).querySelectorAll('button')).find(b=>b.textContent.trim()===" +
        JSON.stringify(text) +
        ")?.click()"
    );
  const edit = () =>
    evaluate(
      "Array.from(document.querySelectorAll('.yk-profile-actions button')).find(b=>['Modifier le profil','Edit profile'].includes(b.textContent.trim()))?.click()"
    );
  const upload = (size = 0) =>
    evaluate(`(()=>{
    const file = new File([${size} ? new Uint8Array(${size}) : Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),c=>c.charCodeAt(0))],'test-banner.gif',{type:'image/gif'});
    const input=document.querySelector('[data-banner-upload] input');
    const data=new DataTransfer();data.items.add(file);input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  for (const width of [1440, 390]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: width < 700
    });
    await evaluate("window.__proofNavigationPending=true");
    await send("Page.navigate", {
      url:
        (process.env.PREVIEW_ORIGIN ?? "http://localhost:3003") +
        "/design-system/profile-preview?catalogue=demo"
    });
    await until(
      "!window.__proofNavigationPending && !!document.querySelector('.yk-profile-actions button')"
    );
    await delay(1800);
    await edit();
    await until("!!document.querySelector('[data-banner-upload] input')");
    await upload(4 * 1024 * 1024 + 1);
    await until(
      "document.querySelector('[data-profile-editor] [role=alert]')?.textContent.includes('4 MB')"
    );
    assert.equal(
      await evaluate("!!document.querySelector('.yk-banner-crop-stage')"),
      false
    );
    await upload();
    await until(
      "!!document.querySelector('.yk-banner-crop-actions button:last-child') && !document.querySelector('.yk-banner-crop-actions button:last-child').disabled"
    );
    await evaluate(
      `document.querySelector('[aria-label="Rotate image 90 degrees clockwise"]').click()`
    );
    await click("Apply crop");
    await until("!document.querySelector('.yk-banner-crop-stage')");
    await until(
      "document.querySelector('.yk-banner-framed-preview img')?.src.startsWith('blob:')"
    );
    await click("Save");
    await until("!document.querySelector('[data-profile-editor]')");
    await until(
      "document.querySelector('.yk-profile-banner img')?.src.startsWith('blob:')"
    );
    assert.ok(
      (
        await evaluate(
          "document.querySelector('.yk-profile-banner img').style.transform"
        )
      ).includes("rotate(90deg)")
    );
    await edit();
    await until("!!document.querySelector('[data-banner-upload] input')");
    await click("Adjust banner");
    await until("!!document.querySelector('.yk-banner-crop-stage')");
    await click("Cancel");
    await until(
      "!document.querySelector('.yk-banner-crop-stage') && !!document.querySelector('[data-banner-upload] input')"
    );
    await upload();
    await until("!!document.querySelector('.yk-banner-crop-stage')");
    await click("Cancel");
    await until(
      "!document.querySelector('.yk-banner-crop-stage') && !!document.querySelector('[data-banner-upload] input')"
    );
    assert.equal(
      await evaluate("!!document.querySelector('.yk-banner-crop-stage')"),
      false
    );
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(
      new URL(`editor-${width}.png`, root),
      Buffer.from(data, "base64")
    );
    await click("Remove banner");
    await click("Save");
    await until("!document.querySelector('[data-profile-editor]')");
    assert.equal(
      await evaluate("!!document.querySelector('.yk-profile-banner img')"),
      false
    );
  }
  assert.ok(
    requests.every(url => url.endsWith("/get_profile")),
    JSON.stringify(requests)
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: gallery upload, 4 MB guard, crop, rotation, save, reopen, cancel and remove on desktop/mobile; no real profile writes."
  );
} finally {
  socket?.close();
  browser.kill();
}
