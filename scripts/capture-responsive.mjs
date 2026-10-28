import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [, , url, output, width = "390", height = "844"] = process.argv;
if (!url || !output)
  throw new Error(
    "Usage: node scripts/capture-responsive.mjs <url> <output> [width] [height]"
  );
const chrome =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = await mkdtemp(join(tmpdir(), "yokkai-capture-"));
const browser = spawn(
  chrome,
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-gpu-compositing",
    "--disable-gpu-sandbox",
    "--hide-scrollbars",
    "--remote-debugging-port=9223",
    `--user-data-dir=${profile}`,
    "about:blank"
  ],
  { stdio: "ignore" }
);
let target;
for (let attempt = 0; attempt < 40 && !target; attempt += 1) {
  await new Promise(resolve => setTimeout(resolve, 100));
  try {
    target = await fetch("http://127.0.0.1:9223/json/new?about:blank", {
      method: "PUT"
    }).then(response => response.json());
  } catch {}
}
if (!target) {
  browser.kill();
  throw new Error("Chrome DevTools est inaccessible.");
}
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});
let id = 0;
const pending = new Map();
socket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(message.error);
    else entry.resolve(message.result);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, { resolve, reject });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
await send("Emulation.setDeviceMetricsOverride", {
  width: Number(width),
  height: Number(height),
  deviceScaleFactor: 1,
  mobile: Number(width) < 768
});
await send("Emulation.setTouchEmulationEnabled", {
  enabled: Number(width) < 768,
  maxTouchPoints: 1
});
await send("Page.enable");
await send("Page.navigate", { url });
await new Promise(resolve => setTimeout(resolve, 4000));
const { data } = await send("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: false
});
await writeFile(output, Buffer.from(data, "base64"));
await send("Browser.close");
