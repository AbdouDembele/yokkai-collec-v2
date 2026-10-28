import assert from "node:assert/strict";

// Extends the isolated loopback browser proof; no accounts or real messages.
export async function proveSocialUnread({
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
    localStorage.setItem(
      "yokkai:private-messages-preview:v1",
      JSON.stringify([
        {
          id: "unread-proof-1",
          senderId: "preview-kitsune",
          recipientId: "preview-bbdou",
          text: "Unread badge proof",
          createdAt: new Date().toISOString()
        }
      ])
    );
    localStorage.setItem("yokkai:message-reads-preview:v1", "[]");
    localStorage.removeItem("yokkai:friend-request-preview:v1:preview-bbdou");
    window.dispatchEvent(new Event("social-unread-changed"));
  });
  const friend = '[aria-label="Message Kitsune"]';
  const nav = 'nav a[href="/friends"]';
  const badge = selector =>
    `document.querySelector(${JSON.stringify(selector)})?.querySelector('[data-unread-badge]')?.innerText`;
  await until(`${badge(friend)}?.startsWith('+1')`);
  await until(`${badge(nav)}?.startsWith('+1')`);
  await capture("social-unread-desktop.png");
  // Merely opening notifications does not acknowledge the conversation.
  await click('button[aria-controls="notifications-panel"]');
  assert.ok((await evaluate(badge(friend))).startsWith("+1"));
  await click('button[aria-controls="notifications-panel"]');
  await click(friend);
  await until(
    "!!document.querySelector('.yk-private-messages-modal[open] textarea:not(:disabled)')"
  );
  await until(`!${badge(friend)}`);
  await until(`!${badge(nav)}`);
  await click('.yk-private-messages-modal[open] button[aria-label="Close"]');
  // A fresh arrival after closing must restore the badge without a refresh button.
  await run(() => {
    const key = "yokkai:private-messages-preview:v1";
    const messages = JSON.parse(localStorage.getItem(key));
    messages.push({
      id: "unread-proof-2",
      senderId: "preview-kitsune",
      recipientId: "preview-bbdou",
      text: "Another unread message",
      createdAt: new Date().toISOString()
    });
    localStorage.setItem(key, JSON.stringify(messages));
    window.dispatchEvent(new Event("private-message-received"));
    Array.from(document.querySelectorAll("button"))
      .find(button => button.textContent === "Add sample friend request")
      .click();
  });
  await until(`${badge(friend)}?.startsWith('+1')`);
  await until(`${badge(nav)}?.startsWith('+2')`);
  await until(
    "!!Array.from(document.querySelectorAll('[role=tab]')).find(tab=>tab.textContent.startsWith('Received requests'))?.querySelector('[data-unread-badge]')"
  );
  await run(() =>
    Array.from(document.querySelectorAll('[role="tab"]'))
      .find(tab => tab.textContent.startsWith("Received requests"))
      .click()
  );
  await run(() =>
    Array.from(document.querySelectorAll(".yk-social-list button"))
      .find(button => button.textContent === "Accept")
      .click()
  );
  await until(`${badge(nav)}?.startsWith('+1')`);
  await run(() =>
    Array.from(document.querySelectorAll('[role="tab"]'))
      .find(tab => tab.textContent.startsWith("My friends"))
      .click()
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true
  });
  assert.ok(await evaluate(`${badge(friend)}?.startsWith('+1')`));
  assert.ok(
    await run(() => document.documentElement.scrollWidth <= innerWidth),
    "Badges must not introduce mobile overflow"
  );
  await capture("social-unread-mobile.png");
  console.log(
    "Social unread browser proof passed: per-friend badge, navigation total, bell independence, opening acknowledges, fresh arrival, pending request and automatic response update, mobile bounds."
  );
}
