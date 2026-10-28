import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const url =
  process.argv[2] ??
  "http://localhost:3017/design-system/boosters-load-preview";
const chrome =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = await mkdtemp(join(tmpdir(), "yokkai-boosters-load-proof-"));
const browser = spawn(
  chrome,
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--remote-debugging-port=9237",
    "--user-data-dir=" + profile,
    "about:blank"
  ],
  { stdio: "ignore" }
);
let socket;
try {
  let target;
  for (let attempt = 0; attempt < 200 && !target; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    try {
      target = await fetch("http://127.0.0.1:9237/json/new?about:blank", {
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
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }]
  });
  const requests = [];
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.method === "Network.requestWillBeSent")
      requests.push(message.params.request.url);
  });
  await send("Page.navigate", { url });
  await wait(
    "document.querySelector('[data-proof=start]')?.disabled===false",
    "preview hydratée absente"
  );
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function select(label, index) {
    await evaluate(
      `(()=>{const element=document.querySelector('[aria-label="${label}"]');element.value=element.options[${index}].value;element.dispatchEvent(new Event('change',{bubbles:true}));return element.value;})()`
    );
    await sleep(100);
    assert.equal(
      await evaluate(
        `document.querySelector('[aria-label="${label}"]').selectedIndex`
      ),
      index
    );
  }
  const openButtons =
    "[...document.querySelectorAll('.yk-pack-body button')].filter(x=>x.textContent.trim()==='Ouvrir'&&!x.disabled).length";
  const counts = () =>
    evaluate(
      "JSON.parse(document.querySelector('[data-proof=calls]').textContent)"
    );
  const assertions = [];
  const timings = [];
  for (const [index, latency] of [
    [0, 0],
    [1, 800],
    [2, 3000]
  ]) {
    await select("statusDelay", index);
    await select("decisionDelay", index);
    await select("collectionDelay", 3);
    await click("main", "Lancer la simulation");
    await wait(`${openButtons}===2`, `statuts ${latency} ms absents`);
    const values = await counts();
    const events = await evaluate(
      "[...document.querySelectorAll('[data-proof=events] li')].map(item=>item.textContent)"
    );
    timings.push({ latency, events });
    const timeOf = (name, phase) =>
      Number(
        events.find(event => event.includes(`${name} ${phase}`)).split(" ms")[0]
      );
    assert.ok(timeOf("user_cards page 1", "lancé") <= 1200);
    assert.ok(
      timeOf("list_notifications", "lancé") >=
        timeOf("user_cards page 1", "lancé")
    );
    assert.ok(timeOf("get_regular_pack_status", "terminé") >= latency);

    assert.equal(values.get_regular_pack_status, 1);
    assert.equal(values.get_decision_pack_status, 1);
    assert.equal(values["user_cards page 1"], 1);
    assert.equal(values["user_cards page 2"], 1);
    assert.ok(
      await evaluate(
        "document.querySelector('[data-proof=duplicates]').textContent.endsWith('0')"
      )
    );
    assertions.push(
      `Statuts ${latency} ms : Ouvrir disponible avec collection sans réponse, une requête par statut`
    );
  }
  // Partial collection at opening: later arrival must never create a NEW/duplicate label.
  await select("collectionDelay", 2);
  await select("statusDelay", 0);
  await select("decisionDelay", 0);
  await click("main", "Lancer la simulation");
  await wait(`${openButtons}===2`, "ouverture partielle indisponible");
  await click(".yk-pack-panel", "Ouvrir");
  await wait("!!document.querySelector('.yk-deck-button')", "reveal absent");
  await click(".yk-deck-button");
  await sleep(3500);
  assert.equal(
    await evaluate(
      "[...document.querySelectorAll('.yk-reveal-actions')].some(x=>/NEW|Doublon/.test(x.textContent))"
    ),
    false
  );
  assertions.push(
    "Collection partielle puis reçue après ouverture : aucune mention NEW / Doublon"
  );
  // Timeout and resumable pagination, plus the real notification hook lock.
  await select("statusDelay", 3);
  await select("decisionDelay", 3);
  await select("collectionDelay", 3);
  await select("notificationDelay", 3);
  await click("main", "Lancer la simulation");
  await sleep(15500);
  await wait(
    "[...document.querySelectorAll('[role=alert]')].filter(x=>x.textContent.includes('Réessayer')).length>=4",
    "erreurs bornées absentes"
  );
  assert.equal(
    await evaluate(
      "document.querySelector('.yk-pack-grid').textContent.includes('Chargement')"
    ),
    false
  );
  assert.equal(
    await evaluate(
      "document.querySelector('[data-proof=notifications]').textContent.includes('Chargement')"
    ),
    false
  );
  await select("Prochains statuts", 0);
  await select("Prochaine page collection", 0);
  await select("Prochaines notifications", 0);
  await click(".yk-pack-panel", "Réessayer");
  await click(".yk-decision-panel", "Réessayer");
  await click("[data-proof=notifications]", "Réessayer");
  await click("#main-content > p[role=alert]", "Réessayer");
  await wait(`${openButtons}===2`, "retry statuts absent");
  await wait(
    "document.querySelector('[data-proof=notifications]').textContent.includes('Notifications chargées')",
    "retry notifications absent"
  );
  const retried = await counts();
  assert.equal(retried["user_cards page 1"], 1);
  assert.equal(retried["user_cards page 2"], 2);
  assert.equal(retried.list_notifications, 2);
  assert.equal(retried.get_regular_pack_status, 2);
  assertions.push(
    "15 s : erreurs et Réessayer ; reprise uniquement page 2 ; verrou notifications libéré"
  );
  // One status and the player information must not gate the other status.
  await select("statusDelay", 0);
  await select("decisionDelay", 2);
  await select("infoDelay", 3);
  await select("collectionDelay", 3);
  await select("notificationDelay", 0);
  await click("main", "Lancer la simulation");
  await wait(`${openButtons}===1`, "statut régulier indépendant absent");
  await wait(`${openButtons}===2`, "statut décisif indépendant absent");
  await sleep(12500);
  await wait(
    "[...document.querySelectorAll('#main-content > p[role=alert]')].some(x=>x.textContent.includes('15 secondes'))",
    "erreur infos indépendante absente"
  );
  await select("Prochaines infos joueur", 0);
  await click('[data-proof="info-error"]', "Réessayer");
  await wait(
    "document.querySelector('[data-proof=info]')?.textContent.includes('4920')",
    "retry infos absent"
  );
  assertions.push(
    "Chaque statut s’affiche seul ; infos joueur sans réponse puis Réessayer, boosters toujours disponibles"
  );
  // The counter-proof intentionally reproduces the former infinite barrier.
  await select("statusDelay", 0);
  await select("decisionDelay", 0);
  await select("infoDelay", 0);
  await select("notificationDelay", 0);
  await select("collectionDelay", 3);
  await click('[aria-label="Ancien comportement"]');
  await click("main", "Lancer la simulation");
  await sleep(15500);
  assert.equal(await evaluate(openButtons), 0);
  assert.equal(
    await evaluate(
      "document.querySelector('.yk-pack-grid').textContent.includes('Chargement')"
    ),
    true
  );
  assertions.push(
    "Ancien comportement : statuts reçus mais toujours Chargement après 15 s lorsque collection ne répond jamais"
  );
  assert.ok(
    !requests.some(value => /supabase.*\/(rest|auth)\/v1/.test(value)),
    "aucun appel Supabase navigateur dans la preuve"
  );
  assert.equal(exceptions.length, 0, exceptions.join("\n"));
  const result = {
    url,
    assertions,
    timings,
    retried,
    exceptions,
    supabaseRequests: 0
  };
  await writeFile(
    new URL("../docs/boosters-load-proof.json", import.meta.url),
    JSON.stringify(result, null, 2)
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  browser.kill();
}
