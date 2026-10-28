import assert from "node:assert/strict";

// Called by the existing loopback-only browser proof, using its isolated Chrome
// session and mock adapters. Every existing messaging assertion remains intact.
export async function proveConversationTrades({
  run,
  send,
  evaluate,
  click,
  until,
  capture
}) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1050,
    deviceScaleFactor: 1,
    mobile: false
  });
  await run(() => {
    const select = document.querySelector('[aria-label="Preview player"]');
    select.value = "preview-bbdou";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    Array.from(document.querySelectorAll("button"))
      .find(button => button.textContent === "Add sample trades")
      .click();
  });
  await until("!!document.querySelector('[aria-label=\"Message Kitsune\"]')");
  await click('[aria-label="Message Kitsune"]');
  await until(
    "document.querySelectorAll('.yk-conversation-trade').length === 2"
  );
  const received = '.yk-conversation-trade[aria-label="Received trade offer"]';
  const sent = '.yk-conversation-trade[aria-label="Sent trade offer"]';
  assert.ok(
    await evaluate(
      `document.querySelector(${JSON.stringify(received)}).textContent.includes('Sample card · Kitsune')`
    )
  );
  assert.ok(
    await evaluate(
      `document.querySelector(${JSON.stringify(received)}).textContent.includes('Sample card · BBDOU')`
    )
  );
  assert.equal(
    await evaluate(
      `document.querySelector(${JSON.stringify(sent)}).querySelectorAll('button').length`
    ),
    0
  );
  await run(() => {
    const log = document.querySelector(".yk-private-messages-log");
    log.scrollTop +=
      document
        .querySelector(
          '.yk-conversation-trade[aria-label="Received trade offer"]'
        )
        .getBoundingClientRect().top -
      log.getBoundingClientRect().top -
      8;
  });
  await capture("conversation-trades-desktop.png");
  await evaluate(
    `Array.from(document.querySelector(${JSON.stringify(received)}).querySelectorAll('button')).find(button => button.textContent === 'Accept').click()`
  );
  await until(
    "!!document.querySelector('[aria-label=\"Confirm trade acceptance\"]')"
  );
  assert.equal(
    await evaluate(
      "JSON.parse(localStorage.getItem('yokkai:conversation-trades-preview:v1')).filter(offer => offer.status === 'accepted').length"
    ),
    0,
    "Accept must first show the irreversible-transfer confirmation"
  );
  await run(() => {
    const confirm = Array.from(
      document
        .querySelector('[aria-label="Confirm trade acceptance"]')
        .querySelectorAll("button")
    ).find(button => button.textContent === "Confirm trade");
    confirm.click();
    confirm.click();
  });
  await until(
    `document.querySelector(${JSON.stringify(received)}).textContent.includes('Accepted')`
  );
  assert.equal(
    await evaluate(
      `document.querySelector(${JSON.stringify(received)}).querySelectorAll('button').length`
    ),
    0
  );
  assert.equal(
    await evaluate(
      "JSON.parse(localStorage.getItem('yokkai:conversation-trades-preview:v1')).filter(offer => offer.status === 'accepted').length"
    ),
    1
  );
  await click('.yk-private-messages-modal[open] button[aria-label="Close"]');
  await run(() => {
    const select = document.querySelector('[aria-label="Preview player"]');
    select.value = "preview-kitsune";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await until("!!document.querySelector('[aria-label=\"Message BBDOU\"]')");
  await click('[aria-label="Message BBDOU"]');
  await until(
    "document.querySelectorAll('.yk-conversation-trade').length === 2"
  );
  assert.ok(
    await evaluate(
      `document.querySelector(${JSON.stringify(sent)}).textContent.includes('Accepted')`
    ),
    "Sender sees the recipient's acceptance"
  );
  await evaluate(
    `Array.from(document.querySelector(${JSON.stringify(received)}).querySelectorAll('button')).find(button => button.textContent === 'Decline').click()`
  );
  await until(
    `document.querySelector(${JSON.stringify(received)}).textContent.includes('Declined')`
  );
  assert.equal(
    await evaluate(
      `document.querySelector(${JSON.stringify(received)}).querySelectorAll('button').length`
    ),
    0
  );

  // New offer from the conversation returns straight to the same conversation.
  await run(() =>
    Array.from(
      document
        .querySelector(".yk-private-messages-contact")
        .querySelectorAll("button")
    )
      .find(button => button.textContent === "Trade")
      .click()
  );
  await until(
    "!!document.querySelector('.yk-private-trade-modal[open] .yk-trade-composer input[type=number]')"
  );
  await evaluate(
    "document.querySelector('.yk-private-trade-modal .yk-trade-composer input[type=number]').focus()"
  );
  await send("Input.insertText", { text: "25" });
  await run(() =>
    Array.from(
      document
        .querySelector(".yk-private-trade-modal")
        .querySelectorAll("button")
    )
      .find(button => button.textContent === "Send offer")
      .click()
  );
  await until(
    "!document.querySelector('.yk-private-trade-modal[open]') && document.querySelectorAll('.yk-conversation-trade').length === 3"
  );
  assert.ok(
    await evaluate(
      "document.querySelector('.yk-private-messages-modal h2').textContent.includes('BBDOU')"
    )
  );
  const newestId = await evaluate(
    "JSON.parse(localStorage.getItem('yokkai:conversation-trades-preview:v1')).at(-1).id"
  );
  assert.equal(
    await evaluate(
      "JSON.parse(localStorage.getItem('yokkai:conversation-trades-preview:v1')).at(-1).toUser"
    ),
    "preview-bbdou"
  );

  // Simulate the other tab accepting and another friend sending an unrelated
  // offer. Polling must update this card without exposing the other relationship.
  await run(() => {
    const offers = JSON.parse(
      localStorage.getItem("yokkai:conversation-trades-preview:v1")
    );
    const newest = offers.at(-1);
    newest.status = "accepted";
    offers.push({
      ...newest,
      id: "unrelated-trade-proof",
      toUser: "preview-yuki",
      toPseudo: "Yuki",
      status: "pending"
    });
    localStorage.setItem(
      "yokkai:conversation-trades-preview:v1",
      JSON.stringify(offers)
    );
  });
  await until(
    `document.querySelector('[data-trade-id="${newestId}"]').textContent.includes('Accepted')`
  );
  assert.equal(
    await evaluate(
      "document.querySelector('[data-trade-id=\"unrelated-trade-proof\"]')"
    ),
    null
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true
  });
  assert.ok(
    await run(() => {
      const log = document.querySelector(".yk-private-messages-log");
      return (
        log.scrollWidth <= log.clientWidth + 1 &&
        document.documentElement.scrollWidth <= innerWidth
      );
    }),
    "Trade lots must fit a mobile conversation without horizontal overflow"
  );
  await run(() => {
    const log = document.querySelector(".yk-private-messages-log");
    log.scrollTop +=
      document.querySelector(".yk-conversation-trade").getBoundingClientRect()
        .top -
      log.getBoundingClientRect().top -
      8;
  });
  await capture("conversation-trades-mobile.png");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 500,
    deviceScaleFactor: 1,
    mobile: true
  });
  assert.ok(
    await run(
      () =>
        document
          .querySelector('.yk-private-messages-modal button[type="submit"]')
          .getBoundingClientRect().bottom <= innerHeight
    ),
    "Composer stays reachable with trade cards"
  );
  await click('.yk-private-messages-modal[open] button[aria-label="Close"]');
  console.log(
    "Conversation trade browser proof passed: both lots, confirmation, acceptance, decline, new offer return, remote status synchronization, friend isolation and mobile bounds."
  );
}
