import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url =
  process.argv[2] ?? "http://localhost:3000/design-system/player-cache-preview";
const chrome =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = await mkdtemp(join(tmpdir(), "yokkai-cache-proof-"));
const browser = spawn(
  chrome,
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--remote-debugging-port=9227",
    `--user-data-dir=${profile}`,
    "about:blank"
  ],
  { stdio: "ignore" }
);

let socket;
try {
  let target;
  for (let attempt = 0; attempt < 50 && !target; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 100));
    try {
      target = await fetch("http://127.0.0.1:9227/json/new?about:blank", {
        method: "PUT"
      }).then(response => response.json());
    } catch {}
  }
  if (!target) throw new Error("Chrome DevTools est inaccessible.");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(message.error);
    else entry.resolve(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const requestId = ++id;
      pending.set(requestId, { resolve, reject });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
  const evaluate = async expression =>
    (
      await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true
      })
    ).result.value;
  const waitFor = async (expression, label) => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const value = await evaluate(expression);
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`${label} introuvable.`);
  };
  const click = async label => {
    const point = await waitFor(
      `(()=>{const element=[...document.querySelectorAll('button')].find(button=>button.textContent===${JSON.stringify(label)});if(!element)return null;element.scrollIntoView({block:'center'});const rect=element.getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};})()`,
      label
    );
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1
    });
    await new Promise(resolve => setTimeout(resolve, 80));
  };
  const counts = () =>
    evaluate(
      "JSON.parse(document.querySelector('[data-proof-result]').dataset.proofResult)"
    );
  const expect = async (collection, balance, label) => {
    const result = await counts();
    if (result.collection !== collection || result.balance !== balance)
      throw new Error(
        `${label}: ${JSON.stringify(result)}, attendu collection=${collection}, balance=${balance}.`
      );
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url });
  await waitFor(
    "!!document.querySelector('[data-proof-result]')",
    "Preuve du cache"
  );
  await new Promise(resolve => setTimeout(resolve, 500));
  await click("Lire les snapshots");
  await expect(1, 1, "Déduplication initiale");
  await click("Lire les snapshots");
  await expect(1, 1, "Réutilisation avant expiration");
  await click("Avancer de 11 s");
  await click("Lire les snapshots");
  await expect(2, 1, "Expiration Collection à 10 secondes");
  await click("Avancer de 50 s");
  await click("Lire les snapshots");
  await expect(3, 2, "Expiration solde à 60 secondes");
  console.log(
    JSON.stringify({
      url,
      deduplicated: true,
      collectionTtlMs: 10000,
      balanceTtlMs: 60000,
      result: "passed"
    })
  );
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  browser.kill();
}
