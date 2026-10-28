import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url =
  process.argv[2] ??
  "http://localhost:3000/design-system/trade-polling-preview";
const chrome =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = await mkdtemp(join(tmpdir(), "yokkai-trade-proof-"));
const browser = spawn(
  chrome,
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--remote-debugging-port=9229",
    "--user-data-dir=" + profile,
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
      target = await fetch("http://127.0.0.1:9229/json/new?about:blank", {
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
      id += 1;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async expression =>
    (
      await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true
      })
    ).result.value;
  const waitFor = async (expression, label, attempts = 80) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const value = await evaluate(expression);
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(label + " introuvable.");
  };
  const actorText = actor =>
    evaluate(
      "document.querySelector('[data-proof-actor=" +
        JSON.stringify(actor) +
        "]').textContent"
    );
  const click = async (actor, label) => {
    const expression =
      "(()=>{const root=document.querySelector('[data-proof-actor=" +
      JSON.stringify(actor) +
      "]');const element=[...root.querySelectorAll('button')].find(button=>button.textContent===" +
      JSON.stringify(label) +
      ");if(!element)return null;element.scrollIntoView({block:'center'});const rect=element.getBoundingClientRect();return{x:rect.left+rect.width/2,y:rect.top+rect.height/2};})()";
    const point = await waitFor(expression, label);
    await send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...point,
      button: "left",
      clickCount: 1
    });
    await send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...point,
      button: "left",
      clickCount: 1
    });
    await new Promise(resolve => setTimeout(resolve, 100));
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url });
  await waitFor(
    "document.querySelector('[data-proof-actor=proposer]')?.textContent.includes('En attente')",
    "Offre proposeur"
  );
  await waitFor(
    "document.querySelector('[data-proof-actor=recipient]')?.textContent.includes('Accepter')",
    "Offre destinataire"
  );
  await new Promise(resolve => setTimeout(resolve, 2000));
  await click("recipient", "Accepter");
  await click("recipient", "Confirmer l’échange");
  const immediate = await actorText("proposer");
  if (!immediate.includes("En attente") || immediate.includes("Acceptée"))
    throw new Error("Le proposeur a changé avant le cycle de polling.");
  await waitFor(
    "document.querySelector('[data-proof-actor=proposer]')?.textContent.includes('Acceptée')",
    "Acceptation côté proposeur",
    30
  );
  console.log(
    JSON.stringify({
      url,
      beforeCycle: "pending",
      afterCycle: "accepted",
      manualReload: false,
      result: "passed"
    })
  );
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  browser.kill();
}
