import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { proveConversationTrades } from "./browser-proof-conversation-trades.mjs";
import { proveSocialUnread } from "./browser-proof-social-unread.mjs";

const origin =
  process.env.PRIVATE_MESSAGES_PREVIEW_ORIGIN ?? "http://localhost:3002";
assert.ok(
  ["localhost", "127.0.0.1"].includes(new URL(origin).hostname),
  "Local browser proof only"
);
const browser = spawn(
  process.env.CHROME_PATH ??
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--remote-debugging-port=0",
    `--user-data-dir=${await mkdtemp(join(tmpdir(), "yokkai-private-messages-"))}`,
    "about:blank"
  ],
  { stdio: ["ignore", "ignore", "pipe"], windowsHide: true }
);
let socket;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const endpoint = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(
      () => reject(Error("Chrome startup timed out")),
      15000
    );
    browser.on("error", reject);
    browser.stderr.on("data", data => {
      log += data;
      const match = log.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  const targetUrl = new URL(endpoint);
  targetUrl.protocol = "http:";
  targetUrl.pathname = "/json/new";
  targetUrl.search = "?about:blank";
  const target = await (await fetch(targetUrl, { method: "PUT" })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve =>
    socket.addEventListener("open", resolve, { once: true })
  );
  let id = 0;
  const pending = new Map();
  const rpcRequests = [];
  const errors = [];
  const gifUrl = "https://media.giphy.com/media/local-proof/giphy.gif";
  const gifImage = Buffer.from(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    "base64"
  );
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.method === "Fetch.requestPaused") {
      const { requestId, request } = message.params;
      const url = new URL(request.url);
      const fulfill = (contentType, body) =>
        send("Fetch.fulfillRequest", {
          requestId,
          responseCode: 200,
          responseHeaders: [
            { name: "Content-Type", value: contentType },
            { name: "Access-Control-Allow-Origin", value: "*" }
          ],
          body: Buffer.from(body).toString("base64")
        });
      let response;
      if (url.hostname === "api.giphy.com") {
        const asset = { url: gifUrl, width: "160", height: "100" };
        response = fulfill(
          "application/json",
          JSON.stringify({
            data: [
              {
                id: "local-proof",
                title: "Test reaction",
                images: { original: asset, fixed_width_small: asset }
              }
            ],
            pagination: { count: 1, total_count: 1, offset: 0 }
          })
        );
      } else if (request.url === gifUrl)
        response = fulfill("image/gif", gifImage);
      else
        response = send("Fetch.failRequest", {
          requestId,
          errorReason: "BlockedByClient"
        });
      void response.catch(reason => errors.push(String(reason)));
    }
    if (message.method === "Runtime.exceptionThrown")
      errors.push(message.params.exceptionDetails.text);
    if (
      message.method === "Network.requestWillBeSent" &&
      message.params.request.url.includes("/rest/v1/rpc/")
    )
      rpcRequests.push(message.params.request.url);
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      if (message.error) request.reject(message.error);
      else request.resolve(message.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const requestId = ++id;
      pending.set(requestId, { resolve, reject });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    assert.ok(
      !result.exceptionDetails,
      JSON.stringify(result.exceptionDetails)
    );
    return result.result.value;
  };
  const run = fn => evaluate(`(${fn.toString()})()`);
  const until = async expression => {
    for (let attempt = 0; attempt < 300; attempt++) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    const diagnostic = await evaluate(
      "({text:document.body.innerText,draft:document.querySelector('dialog[open] textarea')?.value,stored:localStorage.getItem('yokkai:private-messages-preview:v1')})"
    );
    throw Error(`Timed out: ${expression} ${JSON.stringify(diagnostic)}`);
  };
  const click = selector =>
    evaluate(
      `(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.focus(); element.click(); })()`
    );
  const type = async text => {
    await evaluate("document.querySelector('dialog[open] textarea').focus()");
    await send("Input.insertText", { text });
    await until(
      "!document.querySelector('dialog[open] button[type=submit]').disabled"
    );
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  // Deterministic GIF fixtures; never call GIPHY or other external services in this proof.
  await send("Fetch.enable", { patterns: [{ urlPattern: "https://*" }] });
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1050,
    deviceScaleFactor: 1,
    mobile: false
  });
  await send("Page.navigate", {
    url: origin + "/design-system/private-messages-preview"
  });
  await until("!!document.querySelector('[aria-label=\"Message Kitsune\"]')");
  await click('[aria-label="Message Kitsune"]');
  await until(
    "!!document.querySelector('dialog[open] textarea:not(:disabled)')"
  );
  assert.ok(
    await run(() =>
      document
        .querySelector("dialog[open]")
        .textContent.includes("Start a conversation")
    )
  );
  await type("Hello Kitsune <script>alert(1)</script> 👋");
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13
  });
  await until(
    "document.querySelectorAll('.yk-private-message.is-own').length === 1"
  );
  assert.equal(
    await evaluate(
      "document.querySelector('.yk-private-message p').textContent"
    ),
    "Hello Kitsune <script>alert(1)</script> 👋"
  );
  assert.equal(
    await evaluate(
      "document.querySelectorAll('.yk-private-message script').length"
    ),
    0
  );
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27
  });
  await until("!document.querySelector('dialog[open]')");
  assert.equal(
    await evaluate("document.activeElement.getAttribute('aria-label')"),
    "Message Kitsune"
  );
  await run(() => {
    const select = document.querySelector('[aria-label="Preview player"]');
    select.value = "preview-kitsune";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await until("!!document.querySelector('[aria-label=\"Message BBDOU\"]')");
  await click('[aria-label="Message BBDOU"]');
  await until("document.querySelectorAll('.yk-private-message').length === 1");
  assert.equal(
    await evaluate(
      "document.querySelectorAll('.yk-private-message.is-own').length"
    ),
    0
  );
  await type("Hello BBDOU!\nLet's trade tomorrow.");
  await click('dialog[open] button[type="submit"]');
  await until("document.querySelectorAll('.yk-private-message').length === 2");
  await click('dialog[open] button[aria-label="Close"]');
  await run(() => {
    const select = document.querySelector('[aria-label="Preview player"]');
    select.value = "preview-bbdou";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await until("!!document.querySelector('[aria-label=\"Message Kitsune\"]')");
  await run(() =>
    document
      .querySelector(
        '.yk-private-messages-preview-tools input[type="checkbox"]'
      )
      .click()
  );
  await click('[aria-label="Message Kitsune"]');
  await until("document.querySelectorAll('.yk-private-message').length === 2");
  await type("Keep my draft on failure");
  await click('dialog[open] button[type="submit"]');
  await until("!!document.querySelector('dialog[open] [role=alert]')");
  assert.equal(
    await evaluate("document.querySelector('dialog[open] textarea').value"),
    "Keep my draft on failure"
  );
  await click('dialog[open] button[type="submit"]');
  await until("document.querySelectorAll('.yk-private-message').length === 3");
  await run(() => {
    const key = "yokkai:private-messages-preview:v1";
    const messages = JSON.parse(localStorage.getItem(key));
    messages.push({
      id: crypto.randomUUID(),
      senderId: "preview-kitsune",
      recipientId: "preview-bbdou",
      text: "This reply arrived while the conversation stayed open.",
      createdAt: new Date().toISOString()
    });
    localStorage.setItem(key, JSON.stringify(messages));
  });
  await until("document.querySelectorAll('.yk-private-message').length === 4");
  const screenshots = new URL(
    "../artifacts/private-messages/",
    import.meta.url
  );
  await mkdir(screenshots, { recursive: true });
  const capture = async name => {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(new URL(name, screenshots), Buffer.from(data, "base64"));
  };
  await capture("desktop.png");
  await click('dialog[open] button[aria-label="Close"]');
  await run(() =>
    Array.from(document.querySelectorAll("button"))
      .find(button => button.textContent === "Add sample conversation")
      .click()
  );
  await until("!!document.querySelector('[aria-label=\"Message Kitsune\"]')");
  await click('[aria-label="Message Kitsune"]');
  await until("document.querySelectorAll('.yk-private-message').length === 40");
  await run(() =>
    Array.from(document.querySelectorAll("dialog[open] button"))
      .find(button => button.textContent === "Load older messages")
      .click()
  );
  await until("document.querySelectorAll('.yk-private-message').length === 59");
  assert.equal(
    await evaluate(
      "Array.from(document.querySelectorAll('dialog[open] button')).some(button => button.textContent === 'Load older messages')"
    ),
    false
  );
  // Open the existing trade composer with this friend selected, then return to messages.
  await run(() =>
    Array.from(document.querySelectorAll(".yk-private-messages-contact button"))
      .find(button => button.textContent === "Trade")
      .click()
  );
  await until(
    "!!document.querySelector('.yk-private-trade-modal[open] .yk-trade-composer')"
  );
  assert.ok(
    await evaluate(
      "document.querySelector('.yk-private-trade-modal').textContent.includes('Trade with Kitsune')"
    )
  );
  assert.equal(
    await evaluate(
      "document.querySelector('.yk-private-trade-modal .yk-friend-choices')"
    ),
    null,
    "No friend selector is offered from a conversation"
  );
  assert.equal(
    await evaluate(
      "document.querySelector('.yk-private-trade-modal [data-fixed-trade-friend]').dataset.fixedTradeFriend"
    ),
    "preview-kitsune"
  );
  assert.equal(
    await evaluate(
      "document.querySelector('.yk-private-trade-modal').textContent.includes('Yuki')"
    ),
    false,
    "Other friends cannot be chosen or appear in the fixed trade"
  );
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27
  });
  await until(
    "!document.querySelector('.yk-private-trade-modal[open]') && !!document.querySelector('.yk-private-messages-modal[open]')"
  );
  await click(".yk-private-messages-modal .yk-gif-trigger");
  await until(
    "!!document.querySelector('.yk-gif-modal[open] [aria-label=\"Preview: Test reaction\"]')"
  );
  // Escape closes only the GIF picker, never the parent conversation.
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27
  });
  await send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27
  });
  await until(
    "!document.querySelector('.yk-gif-modal[open]') && !!document.querySelector('.yk-private-messages-modal[open]')"
  );
  await click(".yk-private-messages-modal .yk-gif-trigger");
  await until(
    "!!document.querySelector('.yk-gif-modal[open] [aria-label=\"Preview: Test reaction\"]')"
  );
  await click('.yk-gif-modal [aria-label="Preview: Test reaction"]');
  await run(() =>
    Array.from(document.querySelectorAll(".yk-gif-preview button"))
      .find(button => button.textContent === "Send this GIF")
      .click()
  );
  await until("!!document.querySelector('.yk-private-messages-gif-draft')");
  assert.equal(
    await evaluate(
      "document.querySelectorAll('.yk-private-messages-modal input[type=file]').length"
    ),
    0,
    "No gallery upload is offered"
  );
  assert.equal(
    await evaluate(
      "document.querySelector('.yk-private-messages-modal textarea').value"
    ),
    ""
  );
  // An empty caption is valid for a GIF-only message.
  await click(".yk-private-messages-modal button[type=submit]");
  await until(
    "!!document.querySelector('.yk-private-message-gif') && !document.querySelector('.yk-private-messages-gif-draft')"
  );
  assert.equal(
    await evaluate(
      "JSON.parse(localStorage.getItem('yokkai:private-messages-preview:v1')).filter(message => message.gifUrl).length"
    ),
    1
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true
  });
  const bounds = await run(() => {
    const dialog = document
      .querySelector("dialog[open]")
      .getBoundingClientRect();
    const compose = document
      .querySelector("dialog[open] textarea")
      .getBoundingClientRect();
    return {
      left: dialog.left,
      right: dialog.right,
      bottom: compose.bottom,
      width: innerWidth,
      height: innerHeight,
      overflow: document.documentElement.scrollWidth > innerWidth
    };
  });
  assert.ok(
    bounds.left >= 0 &&
      bounds.right <= bounds.width &&
      bounds.bottom < bounds.height &&
      !bounds.overflow,
    JSON.stringify(bounds)
  );
  await capture("mobile.png");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 500,
    deviceScaleFactor: 1,
    mobile: true
  });
  assert.ok(
    await run(() => {
      const submit = document
        .querySelector('dialog[open] button[type="submit"]')
        .getBoundingClientRect();
      const log = document
        .querySelector(".yk-private-messages-log")
        .getBoundingClientRect();
      return (
        submit.bottom <= innerHeight &&
        log.height >= 60 &&
        document.documentElement.scrollWidth <= innerWidth
      );
    }),
    "Composer and send button must stay reachable in a short mobile viewport"
  );
  await capture("mobile-short.png");
  await click('dialog[open] button[aria-label="Close"]');
  assert.equal(
    await evaluate(
      "localStorage.getItem('yokkai:private-messages-preview:v1') !== null"
    ),
    true
  );
  // The bell coalesces incoming messages and opens that sender, not another friend.
  await click('button[aria-controls="notifications-panel"]');
  await until("!!document.querySelector('[data-notification-kind=message] a')");
  assert.equal(
    await evaluate(
      "document.querySelectorAll('[data-notification-kind=message]').length"
    ),
    1
  );
  assert.equal(
    await evaluate(
      "document.querySelector('[data-notification-kind=message] a').getAttribute('href')"
    ),
    "/friends?message=preview-kitsune"
  );
  await click("[data-notification-kind=message] a");
  await until(
    "!!document.querySelector('.yk-private-messages-modal[open] textarea:not(:disabled)')"
  );
  assert.ok(
    await evaluate(
      "document.querySelector('.yk-private-messages-modal h2').textContent.includes('Kitsune')"
    )
  );
  await click('.yk-private-messages-modal[open] button[aria-label="Close"]');
  await proveConversationTrades({ run, send, evaluate, click, until, capture });
  await proveSocialUnread({ run, send, evaluate, click, until, capture });
  assert.deepEqual(errors, []);
  assert.ok(
    rpcRequests.every(
      url =>
        new URL(url).hostname === "127.0.0.1" &&
        new URL(url).pathname === "/rest/v1/rpc/get_profile"
    ),
    "Only the existing navigation's read-only local profile lookup is allowed; no messaging RPC or other mutation"
  );
  console.log(
    "Private messages browser proof passed: send/reply, literal text, draft/retry, pagination, friend-selected Trade modal, GIPHY-only messages without gallery uploads, nested Escape/focus, mobile bounds and zero live messaging RPCs."
  );
} finally {
  socket?.close();
  browser.kill();
}
