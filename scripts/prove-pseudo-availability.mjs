import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url =
  process.argv[2] ??
  "http://localhost:3000/design-system/pseudo-availability-preview";
const chrome =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = await mkdtemp(join(tmpdir(), "yokkai-pseudo-proof-"));
const browser = spawn(
  chrome,
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--remote-debugging-port=9225",
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
      target = await fetch("http://127.0.0.1:9225/json/new?about:blank", {
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
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const value = await evaluate(expression);
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`${label} introuvable.`);
  };
  const click = async selector => {
    const point = await waitFor(
      `(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)return null;const rect=element.getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+rect.height/2};})()`,
      "Champ pseudo"
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
  const key = async (
    type,
    keyName,
    modifiers = 0,
    code,
    windowsVirtualKeyCode
  ) =>
    send("Input.dispatchKeyEvent", {
      type,
      key: keyName,
      code,
      windowsVirtualKeyCode,
      text: type === "char" ? keyName : undefined,
      modifiers
    });
  const typeText = async value => {
    for (const character of value) await key("char", character);
  };
  const clear = async () => {
    await key("keyDown", "a", 2, "KeyA", 65);
    await key("keyUp", "a", 2, "KeyA", 65);
    await key("keyDown", "Backspace", 0, "Backspace", 8);
    await key("keyUp", "Backspace", 0, "Backspace", 8);
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url });
  await waitFor("!!document.querySelector('#pseudo')", "Champ pseudo");
  await click("#pseudo");

  await typeText("ab");
  await new Promise(resolve => setTimeout(resolve, 650));
  const invalidCalls = await evaluate(
    "window.__pseudoAvailabilityCalls?.length ?? 0"
  );
  if (invalidCalls !== 0)
    throw new Error(
      `Le pseudo trop court a déclenché ${invalidCalls} appel(s).`
    );

  await clear();
  await typeText("Kitsune");
  await new Promise(resolve => setTimeout(resolve, 520));
  await clear();
  await typeText("KitsuneLibre");
  await waitFor(
    "document.querySelector('#pseudo-availability')?.textContent === 'Disponible'",
    "État disponible"
  );
  await new Promise(resolve => setTimeout(resolve, 750));
  const staleState = await evaluate(
    "document.querySelector('#pseudo-availability')?.textContent"
  );
  if (staleState !== "Disponible")
    throw new Error(`Une réponse obsolète a écrasé l'état : ${staleState}.`);

  await clear();
  await typeText("Kitsune");
  await waitFor(
    "document.querySelector('#pseudo-availability')?.textContent === 'Déjà pris'",
    "État déjà pris"
  );
  const calls = await evaluate("window.__pseudoAvailabilityCalls");
  console.log(
    JSON.stringify({
      url,
      invalidPseudoCalls: invalidCalls,
      staleResponseIgnored: true,
      finalIndicator: "Déjà pris",
      calls,
      result: "passed"
    })
  );
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  browser.kill();
}
