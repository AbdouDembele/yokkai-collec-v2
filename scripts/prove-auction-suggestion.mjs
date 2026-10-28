import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url =
  process.argv[2] ??
  "http://localhost:3000/design-system/auction-suggestion-preview";
const chrome =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = await mkdtemp(join(tmpdir(), "yokkai-auction-proof-"));
const browser = spawn(
  chrome,
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--remote-debugging-port=9224",
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
      target = await fetch("http://127.0.0.1:9224/json/new?about:blank", {
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
  const click = async expression => {
    const point = await waitFor(
      `(()=>{const element=${expression};if(!element)return null;element.scrollIntoView({block:'center'});const rect=element.getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};})()`,
      "Cible du clic"
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
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url });
  await waitFor(
    "!!document.querySelector('.yk-collection-card')",
    "Carte de collection"
  );
  await new Promise(resolve => setTimeout(resolve, 1000));
  await click("document.querySelector('.yk-collection-card')");
  await click("document.querySelector('.yk-detail-actions button')");
  await waitFor(
    "!!document.querySelector('.yk-auction-suggestion button')",
    "Suggestion de prix"
  );
  const before = await evaluate(
    "document.querySelector('#auction-price').value"
  );
  const suggestion = await evaluate(
    "document.querySelector('.yk-auction-suggestion').textContent"
  );
  if (before !== "10")
    throw new Error(`Le prix initial vaut ${before}, attendu : 10.`);
  if (!suggestion.includes("240"))
    throw new Error(`Suggestion inattendue : ${suggestion}`);
  await click("document.querySelector('.yk-auction-suggestion button')");
  const after = await evaluate(
    "document.querySelector('#auction-price').value"
  );
  if (after !== "240")
    throw new Error(`Le clic a produit ${after}, attendu : 240.`);
  console.log(
    JSON.stringify({
      url,
      initialPrice: before,
      suggestion: 240,
      priceAfterClick: after,
      result: "passed"
    })
  );
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  browser.kill();
}
