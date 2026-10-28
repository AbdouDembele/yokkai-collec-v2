import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url =
  process.argv[2] ??
  "http://localhost:3000/design-system/direct-invalidation-preview";
const chrome =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = await mkdtemp(join(tmpdir(), "yokkai-actions-proof-"));
const browser = spawn(
  chrome,
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--remote-debugging-port=9228",
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
      target = await fetch("http://127.0.0.1:9228/json/new?about:blank", {
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
      const requestId = id + 1;
      id = requestId;
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
    throw new Error(label + " introuvable.");
  };
  const state = () =>
    evaluate(
      "JSON.parse(document.querySelector('[data-proof-state]').dataset.proofState)"
    );
  const click = async label => {
    const expression =
      "(()=>{const element=[...document.querySelectorAll('button')].find(button=>button.textContent===" +
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
  const expect = async (expected, label) => {
    const actual = await state();
    for (const [key, value] of Object.entries(expected))
      if (actual[key] !== value)
        throw new Error(
          label +
            ": " +
            JSON.stringify(actual) +
            ", attendu " +
            key +
            "=" +
            value +
            "."
        );
    if (actual.reveal !== 2)
      throw new Error(label + ": le reveal a été perturbé.");
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url });
  await waitFor("!!document.querySelector('[data-proof-state]')", "Preuve");
  await new Promise(resolve => setTimeout(resolve, 3000));
  await click("Mettre aux enchères");
  await expect({ image: "image-catalogue" }, "Image après mise en vente");
  await click("Placer une mise");
  await expect({ bidBalance: 450 }, "Solde après mise");
  await click("Accepter l’échange");
  await expect({ tradeCollection: 4, tradeBalance: 475 }, "Échange accepté");
  await click("Réclamer le succès");
  await expect({ achievementBalance: 600 }, "Solde après succès");
  console.log(
    JSON.stringify({
      url,
      actions: ["createAuction", "placeBid", "acceptTrade", "claimAchievement"],
      revealPreserved: true,
      result: "passed"
    })
  );
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  browser.kill();
}
