import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const url =
  process.argv[2] ?? "http://localhost:3012/design-system/moderation-preview";
const chrome =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = await mkdtemp(join(tmpdir(), "yokkai-moderation-proof-"));
const browser = spawn(
  chrome,
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--remote-debugging-port=9231",
    "--user-data-dir=" + profile,
    "about:blank"
  ],
  { stdio: "ignore" }
);
let socket;
try {
  let target;
  for (let attempt = 0; attempt < 60 && !target; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    try {
      target = await fetch("http://127.0.0.1:9231/json/new?about:blank", {
        method: "PUT"
      }).then(r => r.json());
    } catch {}
  }
  assert.ok(target, "Chrome DevTools inaccessible");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const exceptions = [];
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown")
      exceptions.push(message.params.exceptionDetails.text);
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(message.error);
    else entry.resolve(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      id++;
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
  const wait = async (expression, label) => {
    for (let i = 0; i < 100; i++) {
      const result = await evaluate(expression);
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(label);
  };
  const text = selector =>
    evaluate(
      `document.querySelector(${JSON.stringify(selector)})?.textContent`
    );
  async function click(selector, label) {
    const expression = `(()=>{const root=document.querySelector(${JSON.stringify(selector)});const element=${label ? `[...root?.querySelectorAll('button,summary')??[]].find(x=>x.textContent.trim().endsWith(${JSON.stringify(label)}))` : "root"};if(!element||element.disabled)return null;element.scrollIntoView({block:'center'});const r=element.getBoundingClientRect();return r.width&&r.height?{x:r.left+r.width/2,y:r.top+r.height/2}:null;})()`;
    const point = await wait(
      expression,
      "Contrôle absent: " + selector + " " + (label ?? "")
    );
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
    await new Promise(resolve => setTimeout(resolve, 120));
  }
  const openDialog = label =>
    wait(
      `document.querySelector('dialog[open]')?.textContent.includes(${JSON.stringify(label)})`,
      "Dialogue absent: " + label
    );
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url });
  await wait(
    "document.querySelector('[data-proof=profile]')?.textContent.includes('Déjà ami')",
    "Profil chargé"
  );
  await click("[data-proof=profile]", "⋯");
  await click("[data-proof=profile]", "Bloquer");
  await openDialog("Bloquer Mochi ?");
  assert.match(await text("dialog[open]"), /Il ne sera pas prévenu/);
  await click("dialog[open]", "Bloquer");
  await wait(
    "document.querySelector('[data-proof=profile]')?.textContent.includes('Débloquer')",
    "Blocage du profil"
  );
  await click("[data-proof=profile]", "Débloquer");
  await wait(
    "document.querySelector('[data-proof=profile]')?.textContent.includes('Ajouter en ami')",
    "Déblocage profil"
  );
  await click("[data-proof=profile]", "Ajouter en ami");
  await wait(
    "document.querySelector('[data-proof=profile]')?.textContent.includes('Demande envoyée')",
    "Demande après déblocage"
  );
  await click("[data-proof=profile]", "Signaler");
  await openDialog("Signaler Mochi");
  await click("dialog[open] textarea");
  await send("Input.insertText", { text: "Détail depuis le profil" });
  await click("dialog[open]", "Transmettre le signalement");
  await wait(
    "document.querySelector('.yk-toast[role=status]')?.textContent === 'Merci, ton signalement a été transmis.'",
    "Confirmation signalement profil"
  );

  await click("[data-proof=friends] input");
  await send("Input.insertText", { text: "Yuki" });
  await wait(
    "document.querySelector('[data-proof=friends] .is-search')?.textContent.includes('Débloquer')",
    "Recherche respecte blocage"
  );
  await click("[data-proof=friends] .is-search", "Débloquer");
  await wait(
    "document.querySelector('[data-proof=friends] .is-search')?.textContent.includes('Ajouter en ami')",
    "Déblocage recherche"
  );
  await click("[data-proof=friends]", "Bloqués · 1");
  await click("[data-proof=friends]", "Débloquer");
  assert.match(await text("[data-proof=friends]"), /Aucun joueur bloqué/);

  await click("[data-proof=chat]", "Signaler");
  await openDialog("Signaler Mochi");
  await click("dialog[open] textarea");
  await send("Input.insertText", { text: "Détail depuis le chat" });
  await click("dialog[open] input[type=checkbox]");
  await click("dialog[open]", "Transmettre le signalement");
  await wait(
    "document.querySelector('[data-proof=chat]')?.textContent.includes('Aucun message pour le moment.')",
    "Signalement chat avec blocage"
  );

  assert.match(
    await text("[data-proof=chat]"),
    /Merci, ton signalement a été transmis/
  );

  for (const context of ["Profil : états", "Amis : états"]) {
    const root = `[data-proof="${context}"]`;
    assert.match(await text(root + " [data-state=accepted]"), /Déjà ami/);
    assert.match(
      await text(root + " [data-state=outgoing]"),
      /Demande envoyée/
    );
    await click(root + " [data-state=blocked]", "Débloquer");
    await wait(
      `document.querySelector(${JSON.stringify(root + " [data-state=blocked]")})?.textContent.includes('Ajouter en ami')`,
      "État débloqué"
    );
    await click(root + " [data-state=none]", "Ajouter en ami");
    await click(root + " [data-state=incoming]", "Accepter");
    await click(root + " [data-state=incoming-refuse]", "Refuser");
    await openDialog("Refuser cette demande ?");
    await click("dialog[open]", "Refuser");
  }
  const log = await text("#moderation-proof-log");
  assert.equal(
    log.split("\n").filter(x => x === "list-blocked").length,
    2,
    "Une lecture par page Profil/Amis, aucune par recherche"
  );
  for (const context of ["profile", "auction_chat"])
    assert.match(log, new RegExp("report:" + context + ":harassment:Détail"));
  assert.deepEqual(exceptions, []);
  console.log(
    JSON.stringify({
      url,
      result: "passed",
      realMouseClicks: true,
      profile: true,
      friends: true,
      chat: true,
      friendActionContexts: 2,
      listLoads: 2,
      exceptions
    })
  );
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  browser.kill();
}
