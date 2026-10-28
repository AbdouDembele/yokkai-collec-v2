const endpoint = "http://localhost:9222";

async function newPage(url) {
  const page = await (
    await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, {
      method: "PUT"
    })
  ).json();
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  });
  const command = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const requestId = ++id;
      pending.set(requestId, { resolve, reject });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
  const evaluate = async expression =>
    (
      await command("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true
      })
    ).result.value;
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Page.navigate", { url });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      await evaluate(
        "document.readyState==='complete' && !!document.querySelector('[role=tab]')"
      )
    )
      break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return { socket, command, evaluate };
}

async function clickTab(page, label) {
  await new Promise(resolve => setTimeout(resolve, 500));
  const clicked = await page.evaluate(
    `(()=>{const element=[...document.querySelectorAll('[role=tab]')].find(node=>node.textContent.includes(${JSON.stringify(label)}));if(!element)return false;element.click();return true;})()`
  );
  if (!clicked) throw new Error(`Onglet introuvable : ${label}`);
  for (let attempt = 0; attempt < 20; attempt++) {
    if (
      await page.evaluate(
        `([...document.querySelectorAll('[role=tab]')].find(node=>node.textContent.includes(${JSON.stringify(label)}))?.getAttribute('aria-selected')==='true')`
      )
    )
      return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Le clic sur ${label} n'a pas activé l'onglet`);
}

async function scenario(disabled) {
  const url = `http://localhost:3000/design-system/auction-participation-preview${disabled ? "?disabled=1" : ""}`;
  const page = await newPage(url);
  await clickTab(page, "Mes enchères");
  const result = await page.evaluate(
    `(()=>({mode:document.querySelector('[data-proof-mode]')?.getAttribute('data-proof-mode'),selected:[...document.querySelectorAll('[role=tab]')].find(node=>node.textContent.includes('Mes enchères'))?.getAttribute('aria-selected'),cards:[...document.querySelectorAll('.yk-market-tile')].map(node=>node.textContent.trim()),empty:document.querySelector('.yk-empty-state')?.textContent.trim()??null}))()`
  );
  page.socket.close();
  return result;
}

const enabled = await scenario(false);
const counterproof = await scenario(true);
console.log(JSON.stringify({ enabled, counterproof }, null, 2));
if (
  enabled.selected !== "true" ||
  enabled.cards.length !== 2 ||
  !enabled.cards.some(value => value.includes("Surenchéri")) ||
  !enabled.cards.some(value => value.includes("En tête"))
)
  process.exitCode = 1;
if (
  counterproof.selected !== "true" ||
  counterproof.cards.length !== 1 ||
  counterproof.cards.some(value => value.includes("Surenchéri"))
)
  process.exitCode = 1;
