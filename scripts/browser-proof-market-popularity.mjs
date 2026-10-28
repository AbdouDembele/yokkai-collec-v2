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
        "document.readyState==='complete' && !!document.querySelector('.yk-market-tile')"
      )
    )
      break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return { socket, evaluate };
}

async function scenario(disabled) {
  const page = await newPage(
    `http://localhost:3000/design-system/market-popularity-preview${disabled ? "?disabled=1" : ""}`
  );
  await new Promise(resolve => setTimeout(resolve, 300));
  const clicked = await page.evaluate(
    `(()=>{const button=[...document.querySelectorAll('button')].find(node=>node.textContent.includes('Les + populaires'));if(!button)return false;button.click();return true;})()`
  );
  if (!clicked) throw new Error("Bouton de popularité introuvable");
  for (let attempt = 0; attempt < 20; attempt++) {
    if (
      await page.evaluate(
        `([...document.querySelectorAll('button')].find(node=>node.textContent.includes('Les + populaires'))?.getAttribute('aria-pressed')==='true')`
      )
    )
      break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const result = await page.evaluate(
    `(()=>({mode:document.querySelector('[data-proof-mode]')?.getAttribute('data-proof-mode'),selected:[...document.querySelectorAll('button')].find(node=>node.textContent.includes('Les + populaires'))?.getAttribute('aria-pressed'),order:[...document.querySelectorAll('.yk-market-tile')].map(node=>node.textContent.match(/(?:Kuro|Aoi|Ren)[^S]*/)?.[0]?.trim())}))()`
  );
  page.socket.close();
  return result;
}

const enabled = await scenario(false);
const counterproof = await scenario(true);
console.log(JSON.stringify({ enabled, counterproof }, null, 2));
if (
  enabled.selected !== "true" ||
  enabled.order.join("|") !==
    "Aoi · 900 favoris · fin proche|Kuro · 900 favoris · fin tardive|Ren · 120 favoris · finit en premier"
)
  process.exitCode = 1;
if (
  counterproof.selected !== "true" ||
  counterproof.order.join("|") !==
    "Ren · 120 favoris · finit en premier|Aoi · 900 favoris · fin proche|Kuro · 900 favoris · fin tardive"
)
  process.exitCode = 1;
