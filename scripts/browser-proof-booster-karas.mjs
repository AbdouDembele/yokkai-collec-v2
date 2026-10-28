const endpoint = "http://localhost:9222";

async function newPage(url, width = 1280, height = 900) {
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
    if (!message.id || !pending.has(message.id)) return;
    const promise = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) promise.reject(new Error(message.error.message));
    else promise.resolve(message.result);
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
  await command("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width <= 430
  });
  await command("Page.navigate", { url });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      await evaluate(
        "document.readyState==='complete'&&!!document.querySelector('[data-proof=regular] button')"
      )
    )
      break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await new Promise(resolve => setTimeout(resolve, 300));
  return { socket, evaluate };
}

async function click(page, rootSelector, label, occurrence = 0) {
  const clicked = await page.evaluate(
    `(()=>{const root=document.querySelector(${JSON.stringify(rootSelector)});const button=[...root.querySelectorAll('button')].filter(node=>node.textContent.includes(${JSON.stringify(label)})||node.getAttribute('aria-label')?.includes(${JSON.stringify(label)}))[${occurrence}];if(!button)return false;button.click();return true;})()`
  );
  if (!clicked)
    throw new Error(
      `Bouton ${label} #${occurrence + 1} introuvable dans ${rootSelector}`
    );
  await new Promise(resolve => setTimeout(resolve, 100));
}

async function regularScenario(disabled = false, width = 1280) {
  const suffix = disabled ? "?disabled=1" : "";
  const page = await newPage(
    `http://localhost:3000/design-system/booster-karas-preview${suffix}`,
    width,
    width <= 430 ? 844 : 900
  );
  const initial = await page.evaluate(
    `(()=>{const root=document.querySelector('[data-proof=regular]');const mode=[...root.querySelectorAll('button')].find(node=>node.textContent.includes('Sélectionner'));const modeRect=mode.getBoundingClientRect();const progressRect=root.querySelector('.yk-reveal-progress').getBoundingClientRect();return{individual:[...root.querySelectorAll('button')].filter(node=>node.textContent.trim()==='Défausser').length,modeWidth:modeRect.width,modeLeft:modeRect.left,modeCenterY:modeRect.top+modeRect.height/2,progressCenterY:progressRect.top+progressRect.height/2,containerWidth:root.getBoundingClientRect().width};})()`
  );
  await click(page, "[data-proof=regular]", "Défausser");
  const individualConfirmation = await page.evaluate(
    "document.querySelector('dialog[open]')?.textContent.replace(/\\s+/g,' ').trim()"
  );
  await click(page, "dialog[open]", "Annuler");
  await click(page, "[data-proof=regular]", "Sélectionner");
  const individualInMode = await page.evaluate(
    "[...document.querySelector('[data-proof=regular]').querySelectorAll('button')].filter(node=>node.textContent.trim()==='Défausser').length"
  );
  await click(page, "[data-proof=regular]", "Sélectionner Kumo");
  await click(page, "[data-proof=regular]", "Sélectionner Kuro");
  const multiple = await page.evaluate(
    `(()=>{const root=document.querySelector('[data-proof=regular]');return{bar:root.querySelector('.yk-selection-bar')?.textContent.replace(/\\s+/g,' ').trim(),selected:root.querySelectorAll('[aria-pressed=true].yk-reveal-card').length};})()`
  );
  await click(page, "[data-proof=regular]", "Tout");
  const all = await page.evaluate(
    "document.querySelector('[data-proof=regular]').querySelectorAll('[aria-pressed=true].yk-reveal-card').length"
  );
  await click(page, "[data-proof=regular]", "Aucune");
  const none = await page.evaluate(
    "document.querySelector('[data-proof=regular]').querySelectorAll('[aria-pressed=true].yk-reveal-card').length"
  );
  await click(page, "[data-proof=regular]", "Sélectionner Kumo");
  await click(page, "[data-proof=regular]", "Sélectionner Ren");
  await click(page, "[data-proof=regular]", "Détruire la sélection");
  const confirmation = await page.evaluate(
    `(()=>{const dialog=document.querySelector('dialog[open]');return{text:dialog?.textContent.replace(/\\s+/g,' ').trim(),confirmDisabled:[...dialog.querySelectorAll('button')].at(-1)?.disabled};})()`
  );
  if (!disabled) {
    await click(page, "dialog[open]", "Détruire la sélection");
    for (let attempt = 0; attempt < 50; attempt++) {
      if (
        await page.evaluate(
          "document.querySelectorAll('[data-proof=regular] .yk-reveal-slot').length===3"
        )
      )
        break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const afterDestroy = await page.evaluate(
      `(()=>{const root=document.querySelector('[data-proof=regular]');const audit=root.querySelector('[data-proof-audit]');return{cards:root.querySelectorAll('.yk-reveal-slot').length,balance:audit.dataset.balance,owned:audit.dataset.owned,continueVisible:[...root.querySelectorAll('button')].some(node=>node.textContent.includes('Continuer'))};})()`
    );
    await click(page, "[data-proof=regular]", "Continuer");
    const completed = await page.evaluate(
      "document.querySelector('[data-proof-audit]').dataset.completed"
    );
    const mobile = await page.evaluate(
      "({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})"
    );
    const individualAfterMode = await page.evaluate(
      "[...document.querySelector('[data-proof=regular]').querySelectorAll('button')].filter(node=>node.textContent.trim()==='Défausser').length"
    );
    page.socket.close();
    return {
      initial,
      individualConfirmation,
      individualInMode,
      multiple,
      all,
      none,
      confirmation,
      afterDestroy,
      completed,
      individualAfterMode,
      mobile
    };
  }
  const mobile = await page.evaluate(
    "({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})"
  );
  page.socket.close();
  return {
    initial,
    individualConfirmation,
    individualInMode,
    multiple,
    all,
    none,
    confirmation,
    mobile
  };
}

async function destroyAllScenario() {
  const page = await newPage(
    "http://localhost:3000/design-system/booster-karas-preview"
  );
  await click(page, "[data-proof=regular]", "Sélectionner");
  await click(page, "[data-proof=regular]", "Tout");
  await click(page, "[data-proof=regular]", "Détruire la sélection");
  const confirmation = await page.evaluate(
    "document.querySelector('dialog[open]')?.textContent.replace(/\\s+/g,' ').trim()"
  );
  await click(page, "dialog[open]", "Détruire la sélection");
  for (let attempt = 0; attempt < 50; attempt++) {
    if (
      await page.evaluate(
        "document.querySelector('[data-proof-audit]').dataset.returned==='true'"
      )
    )
      break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const result = await page.evaluate(
    `(()=>{const audit=document.querySelector('[data-proof-audit]');return{returned:audit.dataset.returned,balance:audit.dataset.balance,owned:audit.dataset.owned,cards:document.querySelectorAll('[data-proof=regular] .yk-reveal-slot').length};})()`
  );
  page.socket.close();
  return { confirmation, result };
}

async function decisionScenario() {
  const rewards = [15, 15, 14, 13, 15],
    results = [];
  for (let index = 0; index < 5; index++) {
    const page = await newPage(
      "http://localhost:3000/design-system/booster-karas-preview"
    );
    await click(page, "[data-proof=decision]", "Garder celle-ci", index);
    results.push(
      await page.evaluate(
        "document.querySelector('dialog[open]')?.textContent.replace(/\\s+/g,' ').trim()"
      )
    );
    page.socket.close();
  }
  return { rewards, results };
}

const enabled = await regularScenario(false);
const counterproof = await regularScenario(true);
const mobile = await regularScenario(false, 390);
const destroyAll = await destroyAllScenario();
const decision = await decisionScenario();
console.log(
  JSON.stringify(
    { enabled, counterproof, mobile, destroyAll, decision },
    null,
    2
  )
);

if (
  enabled.initial.individual !== 5 ||
  !enabled.individualConfirmation.includes("Tu recevras 1 Kara") ||
  enabled.individualInMode !== 0 ||
  enabled.individualAfterMode !== 3
)
  process.exitCode = 1;
if (enabled.initial.modeWidth >= enabled.initial.containerWidth / 2)
  process.exitCode = 1;
if (
  enabled.multiple.selected !== 2 ||
  !enabled.multiple.bar.includes("4") ||
  enabled.all !== 5 ||
  enabled.none !== 0
)
  process.exitCode = 1;
if (
  !enabled.confirmation.text.includes("Tu recevras 5 Karas") ||
  enabled.confirmation.confirmDisabled
)
  process.exitCode = 1;
if (
  enabled.afterDestroy.cards !== 3 ||
  enabled.afterDestroy.balance !== "5" ||
  enabled.afterDestroy.owned.includes("regular-c") ||
  enabled.afterDestroy.owned.includes("regular-ssr") ||
  enabled.completed !== "true"
)
  process.exitCode = 1;
if (
  counterproof.confirmation.text.includes("Tu recevras") ||
  !counterproof.confirmation.confirmDisabled
)
  process.exitCode = 1;
if (
  mobile.mobile.scrollWidth > mobile.mobile.width ||
  mobile.afterDestroy.cards !== 3
)
  process.exitCode = 1;
if (
  mobile.initial.modeLeft < mobile.mobile.width * 0.55 ||
  Math.abs(mobile.initial.modeCenterY - mobile.initial.progressCenterY) > 20
)
  process.exitCode = 1;
if (
  !destroyAll.confirmation.includes("Tu recevras 15 Karas") ||
  destroyAll.result.returned !== "true" ||
  destroyAll.result.balance !== "15" ||
  destroyAll.result.owned !== "" ||
  destroyAll.result.cards !== 0
)
  process.exitCode = 1;
if (
  decision.results.some(
    (text, index) =>
      !text.includes(
        `+${decision.rewards[index]} Karas depuis les cartes non conservées`
      )
  )
)
  process.exitCode = 1;
