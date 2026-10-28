import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const browser = spawn(
  process.env.CHROME_PATH ??
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--remote-debugging-port=0",
    `--user-data-dir=${await mkdtemp(join(tmpdir(), "yokkai-callouts-"))}`,
    "about:blank"
  ],
  { stdio: ["ignore", "ignore", "pipe"], windowsHide: true }
);
let socket;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const endpoint = await new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(
      () => reject(Error("Chrome startup timed out")),
      15000
    );
    browser.on("error", reject);
    browser.stderr.on("data", data => {
      stderr += data;
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  const origin = new URL(endpoint);
  origin.protocol = "http:";
  origin.pathname = "/json/new";
  origin.search = "?about:blank";
  const target = await (await fetch(origin, { method: "PUT" })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve =>
    socket.addEventListener("open", resolve, { once: true })
  );
  const pending = new Map(),
    requests = [],
    errors = [];
  let id = 0;
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (
      message.method === "Runtime.consoleAPICalled" &&
      ["warning", "error"].includes(message.params.type)
    ) {
      errors.push(
        message.params.args.map(arg => arg.value ?? arg.description).join(" ")
      );
    }
    if (
      message.method === "Log.entryAdded" &&
      ["warning", "error"].includes(message.params.entry.level)
    ) {
      errors.push(
        message.params.entry.text + " " + (message.params.entry.url ?? "")
      );
      console.log("log error", errors.at(-1));
    }
    if (message.method === "Fetch.requestPaused") {
      // The local preview has no signed-in account. Model the unrelated Pro status as inactive.
      socket.send(
        JSON.stringify({
          id: ++id,
          method: "Fetch.fulfillRequest",
          params: {
            requestId: message.params.requestId,
            responseCode: 200,
            responseHeaders: [
              { name: "Content-Type", value: "application/json" }
            ],
            body: Buffer.from('{"active":false}').toString("base64")
          }
        })
      );
    }
    if (message.method === "Runtime.exceptionThrown") {
      const detail = message.params.exceptionDetails;
      errors.push(detail.exception?.description ?? detail.text);
      console.log("browser error", errors.at(-1));
    }
    if (message.method === "Target.attachedToTarget") {
      socket.send(
        JSON.stringify({
          id: ++id,
          method: "Runtime.enable",
          sessionId: message.params.sessionId
        })
      );
    }
    if (
      message.method === "Network.requestWillBeSent" &&
      message.params.request.url.includes("/rpc/")
    )
      requests.push(message.params.request.url);
    const callback = pending.get(message.id);
    if (callback) {
      pending.delete(message.id);
      if (message.error) callback.reject(message.error);
      else callback.resolve(message.result);
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
  const until = async expression => {
    for (let i = 0; i < 2400; i++) {
      if (await evaluate(expression)) return;
      await delay(25);
    }
    throw Error(
      `Timed out: ${expression}; ${await evaluate("JSON.stringify({url:location.href,body:document.body?.innerText.slice(0,1200)})")}`
    );
  };
  await send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true
  });
  await send("Fetch.enable", {
    patterns: [
      {
        urlPattern: "http://localhost:3108/api/pro/benefits",
        requestStage: "Request"
      }
    ]
  });
  await send("Network.enable");
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Log.enable");
  const viewport = async (width, scale = 1) => {
    await send("Emulation.setDeviceMetricsOverride", {
      width: Math.round(width / scale),
      height: Math.round(900 / scale),
      deviceScaleFactor: scale,
      mobile: width < 700
    });
    await evaluate(
      "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))"
    );
  };
  const sharedDesign = async () =>
    await evaluate(`(() => {
              const card = document.querySelector('.yk-lr-reveal .yk-card');
              const reference = document.createElement('div');
              Object.assign(reference.style, {position:'fixed',top:'0',left:'0',opacity:'0',pointerEvents:'none',width:getComputedStyle(card).width});
              const copy = card.cloneNode(true);
              reference.append(copy);
              document.body.append(reference);
              try {
                const differences = [];
                for (const selector of ['', '.yk-card-frame', '.yk-card-interior', '.yk-card-ring', '.yk-card-line', '.yk-card-foil', '.yk-card-category', '.yk-card-badge', '.yk-card-name', '.yk-card-anime', '.yk-card-art img']) {
                  const actualElement = selector ? card.querySelector(selector) : card;
                  const expectedElement = selector ? copy.querySelector(selector) : copy;
                  if (!actualElement && !expectedElement) continue;
                  const actual = getComputedStyle(actualElement);
                  const expected = getComputedStyle(expectedElement);
                  for (const property of ['aspectRatio','backgroundImage','backgroundColor','borderRadius','borderColor','borderWidth','boxShadow','display','fontFamily','fontVariant','fontWeight','fontSize','color','whiteSpace','overflow','objectFit']) {
                    if (actual[property] !== expected[property] && !(property === 'fontSize' && Math.abs(parseFloat(actual[property])-parseFloat(expected[property])) < .05)) differences.push({selector,property,actual:actual[property],expected:expected[property]});
                  }
                }
                return differences;
              } finally { reference.remove(); }
            })()`);
  const report = [];
  await mkdir(new URL("../artifacts/single-animation/", import.meta.url), {
    recursive: true
  });
  for (let pack = 0; pack < 6; pack++) {
    console.log("starting pack", pack + 1);
    await viewport(375);
    if (pack === 0) {
      await send("Page.navigate", {
        url: "http://localhost:3108/design-system/lr-packs"
      });
      await until(
        "!!document.querySelector('.yk-pack-panel .yk-pack-body > button')"
      );
      await until(
        "(()=>{const b=document.querySelector('.yk-pack-panel .yk-pack-body > button');return b&&Object.entries(b).some(([k,v])=>k.startsWith('__reactProps')&&typeof v.onClick==='function');})()"
      );
      console.log("hydrated", pack + 1);
      await evaluate(
        "document.querySelector('.yk-pack-panel .yk-pack-body > button').click()"
      );
    } else {
      await evaluate(
        "document.querySelector('.yk-reveal-next > button').click()"
      );
    }
    await until("!!document.querySelector('.yk-booster-opening iframe')");
    console.log("opening iframe", pack + 1);
    assert.equal(
      await evaluate(
        "document.querySelectorAll('.yk-pack-tear,.yk-opening-pack').length"
      ),
      0
    );
    for (const width of pack === 0
      ? [320, 375, 600, 768, 900, 1024, 1440]
      : []) {
      await viewport(width);
      const bounds = await evaluate(
        "(()=>{const r=document.querySelector('.yk-booster-opening').getBoundingClientRect();return {w:r.width,h:r.height,overflow:document.documentElement.scrollWidth>innerWidth};})()"
      );
      assert.equal(bounds.overflow, false, JSON.stringify({ width, bounds }));
    }
    await viewport(1440, 2);
    assert.equal(
      await evaluate("document.documentElement.scrollWidth>innerWidth"),
      false
    );
    await viewport(1440);
    await evaluate("document.querySelector('.yk-opening-stage').click()");
    await delay(200);
    await evaluate("document.querySelector('.yk-opening-stage')?.click()");
    await until("!!document.querySelector('.yk-deck-button')");
    for (let card = 0; card < 5; card++) {
      await evaluate("document.querySelector('.yk-deck-button').click()");
      if (card === 3) {
        await until("!!document.querySelector('.yk-card-cinematic-ssr')");
        await until(
          "!!document.querySelector('.yk-lr-reveal').style.getPropertyValue('--yk-lr-glass-1')"
        );
        assert.equal(
          await evaluate("document.querySelectorAll('.yk-lr-reveal').length"),
          1
        );
        assert.equal(
          await evaluate(
            "document.querySelectorAll('iframe,.yk-lr-finale,.yk-lr-floor,.yk-lr-edge,.yk-reveal-stage').length"
          ),
          0
        );
        assert.equal(
          await evaluate(
            "document.querySelector('.yk-lr-reveal .yk-card-badge').textContent"
          ),
          "SSR"
        );
        assert.ok(
          await evaluate(
            "getComputedStyle(document.querySelector('.yk-lr-world')).backgroundImage.includes('ssr-pink-world.webp')"
          )
        );
        await evaluate("document.querySelector('.yk-lr-skip').click()");
        assert.ok(
          await evaluate(
            "Math.max(...document.querySelector('.yk-lr-reveal').getAnimations({subtree:true}).map(a=>Number(a.currentTime))) < 4500"
          )
        );
        await evaluate("document.querySelector('.yk-lr-skip').click()");
        assert.equal(
          await evaluate("document.querySelectorAll('.yk-lr-reveal').length"),
          1
        );
        await until("!!document.querySelector('.yk-lr-ready')");
        if (pack === 0) {
          for (const [width, height] of [
            [320, 667],
            [375, 667],
            [768, 900],
            [1024, 900],
            [1440, 900],
            [900, 420]
          ]) {
            await send("Emulation.setDeviceMetricsOverride", {
              width,
              height,
              deviceScaleFactor: 1,
              mobile: width < 700
            });
            await delay(350);
            assert.equal(
              await evaluate("document.documentElement.scrollWidth>innerWidth"),
              false
            );
            assert.deepEqual(
              await sharedDesign(),
              [],
              `SSR shared card differs at ${width}x${height}`
            );
            assert.equal(
              await evaluate(
                `(() => {const a=document.querySelector('.yk-lr-stage').getBoundingClientRect();const b=document.querySelector('.yk-lr-end-controls').getBoundingClientRect();return b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight&&(b.left>=a.right||b.right<=a.left||b.top>=a.bottom||b.bottom<=a.top);})()`
              ),
              true,
              `SSR controls overlap at ${width}x${height}`
            );
          }
          await viewport(1440, 2);
          assert.equal(
            await evaluate("document.documentElement.scrollWidth>innerWidth"),
            false
          );
          await viewport(1440);
          const shot = await send("Page.captureScreenshot", { format: "png" });
          await writeFile(
            new URL(
              "../artifacts/single-animation/SSR-native-pack.png",
              import.meta.url
            ),
            Buffer.from(shot.data, "base64")
          );
          await evaluate(
            "document.querySelector('.yk-lr-end-controls button').click()"
          );
          await until("!document.querySelector('.yk-lr-ready')");
          assert.equal(
            await evaluate("document.querySelectorAll('.yk-lr-reveal').length"),
            1
          );
          await evaluate("document.querySelector('.yk-lr-skip').click()");
          await until("!!document.querySelector('.yk-lr-ready')");
        }
        await evaluate(
          "document.querySelector('.yk-lr-end-controls button:last-child').click()"
        );
      } else if (card === 4) {
        await until("!!document.querySelector('.yk-lr-reveal')");
        await until(
          "!!document.querySelector('.yk-lr-reveal').style.getPropertyValue('--yk-lr-glass-1')"
        );
        assert.equal(
          await evaluate("document.querySelectorAll('.yk-lr-stroke').length"),
          96
        );
        assert.equal(
          await evaluate("document.querySelectorAll('.yk-lr-dot').length"),
          72
        );
        assert.equal(
          await evaluate(
            "document.querySelectorAll('.yk-lr-reveal canvas').length"
          ),
          0
        );
        assert.equal(
          await evaluate("document.querySelectorAll('.yk-lr-reveal').length"),
          1
        );
        assert.ok(
          await evaluate(
            "document.querySelector('.yk-lr-reveal').getAnimations({subtree:true}).some(animation=>animation.playState==='running')"
          ),
          "StrictMode must leave the LR sequence running"
        );
        assert.equal(
          await evaluate(
            "getComputedStyle(document.querySelector('.yk-lr-reveal')).padding"
          ),
          "0px"
        );
        assert.equal(
          await evaluate(
            "document.querySelectorAll('.yk-card-cinematic iframe,.yk-reveal-stage').length"
          ),
          0
        );
        assert.ok(
          (
            await evaluate(
              "getComputedStyle(document.querySelector('.yk-lr-world')).backgroundImage"
            )
          ).includes("lr-gold-world.webp")
        );
        assert.ok(
          (
            await evaluate(
              "getComputedStyle(document.querySelector('.yk-reveal-screen'),'::before').backgroundImage"
            )
          ).includes("regular-opening-nebula.webp")
        );
        for (const width of pack === 0
          ? [320, 375, 600, 768, 900, 1024, 1440]
          : []) {
          await viewport(width);
          assert.equal(
            await evaluate("document.documentElement.scrollWidth>innerWidth"),
            false
          );
          const bounds = await evaluate(
            "(()=>{const r=document.querySelector('.yk-lr-stage').getBoundingClientRect();return {x:r.x,right:r.right,y:r.y,bottom:r.bottom,w:innerWidth,h:innerHeight};})()"
          );
          assert.ok(
            bounds.x >= 0 &&
              bounds.right <= bounds.w &&
              bounds.y >= 0 &&
              bounds.bottom <= bounds.h,
            JSON.stringify(bounds)
          );
        }
        await viewport(1440, 2);
        assert.equal(
          await evaluate("document.documentElement.scrollWidth>innerWidth"),
          false
        );
        await viewport(1440);
        if (pack === 0) {
          await delay(6800);
          const glass = await send("Page.captureScreenshot", { format: "png" });
          await writeFile(
            new URL(
              "../artifacts/single-animation/LR-native-glass.png",
              import.meta.url
            ),
            Buffer.from(glass.data, "base64")
          );
          await delay(3000);
          const { data } = await send("Page.captureScreenshot", {
            format: "png"
          });
          await writeFile(
            new URL(
              "../artifacts/single-animation/LR-native-pack.png",
              import.meta.url
            ),
            Buffer.from(data, "base64")
          );
          await until("!!document.querySelector('.yk-lr-ready')");
          for (const [width, height] of [
            [320, 667],
            [375, 667],
            [768, 900],
            [1024, 900],
            [1440, 900],
            [900, 420]
          ]) {
            await send("Emulation.setDeviceMetricsOverride", {
              width,
              height,
              deviceScaleFactor: 1,
              mobile: width < 700
            });
            await delay(350);
            const designDifferences = await sharedDesign();
            assert.deepEqual(
              designDifferences,
              [],
              `shared card design differs at ${width}x${height}`
            );
            assert.equal(
              await evaluate(`(() => {
              const card = document.querySelector('.yk-lr-stage').getBoundingClientRect();
              const controls = document.querySelector('.yk-lr-end-controls').getBoundingClientRect();
              return controls.left >= 0 && controls.right <= innerWidth && controls.top >= 0 && controls.bottom <= innerHeight &&
                (controls.left >= card.right || controls.right <= card.left || controls.top >= card.bottom || controls.bottom <= card.top);
            })()`),
              true,
              `LR actions overlap the card at ${width}x${height}`
            );
          }
          await viewport(1440);
          await evaluate(
            "document.querySelector('.yk-lr-end-controls button').click()"
          );
          await until("!document.querySelector('.yk-lr-ready')");
          assert.equal(
            await evaluate("document.querySelectorAll('.yk-lr-reveal').length"),
            1
          );
          await until("!!document.querySelector('.yk-lr-ready')");
          await evaluate(
            "document.querySelector('.yk-lr-end-controls button:last-child').click()"
          );
          await until("!document.querySelector('.yk-lr-reveal')");
        } else {
          await evaluate("document.querySelector('.yk-lr-skip').click()");
          assert.equal(
            await evaluate("document.querySelectorAll('.yk-lr-reveal').length"),
            1,
            "landing the card must keep the LR reveal mounted"
          );
          assert.ok(
            await evaluate(
              "Math.max(...document.querySelector('.yk-lr-reveal').getAnimations({subtree:true}).map(a=>Number(a.currentTime))) < 5500"
            ),
            "first click must land the card before its elements reveal"
          );
          await evaluate("document.querySelector('.yk-lr-skip').click()");
          await delay(50);
          assert.ok(
            await evaluate(
              "document.querySelector('.yk-lr-reveal').getAnimations({subtree:true}).every(a=>a.playbackRate===1)"
            ),
            "further clicks must preserve normal card playback"
          );
          assert.ok(
            await evaluate(
              "Math.max(...document.querySelector('.yk-lr-reveal').getAnimations({subtree:true}).map(a=>Number(a.currentTime))) < 6000"
            ),
            "the card elements must remain in sequence"
          );
          if (pack % 2 === 1) {
            await until("!document.querySelector('.yk-lr-skip').disabled");
            assert.ok(
              await evaluate(
                "Math.max(...document.querySelector('.yk-lr-reveal').getAnimations({subtree:true}).map(a=>Number(a.currentTime))) < 14670"
              )
            );
            await evaluate("document.querySelector('.yk-lr-skip').click()");
            assert.equal(
              await evaluate(
                "document.querySelectorAll('.yk-lr-reveal').length"
              ),
              1,
              "skipping bounce keeps the final card visible"
            );
          }
          await until(
            "Math.max(...document.querySelector('.yk-lr-reveal').getAnimations({subtree:true}).map(a=>Number(a.currentTime))) >= 14670"
          );
          await until("!!document.querySelector('.yk-lr-ready')");
          await evaluate(
            "document.querySelector('.yk-lr-end-controls button:last-child').click()"
          );
        }
      } else if (card === 2) await delay(550);
      await until("!!document.querySelector('.yk-deck-button')");
      await evaluate("document.querySelector('.yk-deck-button').click()");
    }
    await until(
      "document.querySelector('.yk-reveal-screen')?.dataset.revealState==='complete'"
    );
    assert.equal(
      await evaluate(
        "[...document.querySelectorAll('.yk-reveal-navigation button')].some(button=>button.textContent.includes('Replay cinematic:'))"
      ),
      false,
      "summary must not duplicate the cinematic replay controls"
    );
    assert.equal(
      await evaluate("document.querySelectorAll('iframe').length"),
      0
    );
    assert.equal(
      await evaluate(
        "document.querySelectorAll('.yk-lr-reveal,.yk-lr-confetti,.yk-lr-floor').length"
      ),
      0
    );
    // Let React's passive unmount cleanup and animation cancellation events settle.
    await evaluate(
      "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))"
    );
    await send("HeapProfiler.collectGarbage");
    if (pack > 0)
      report.push({
        pack,
        pageNodes: await evaluate("document.querySelectorAll('*').length"),
        devPortalNodes: await evaluate(
          "document.querySelector('nextjs-portal')?.shadowRoot?.querySelectorAll('*').length ?? 0"
        ),
        ...(await send("Memory.getDOMCounters")),
        heap: await send("Runtime.getHeapUsage")
      });
  }
  console.log(JSON.stringify({ report, errors }, null, 2));
  await writeFile(
    new URL(
      "../artifacts/single-animation/lr-runtime-proof.json",
      import.meta.url
    ),
    JSON.stringify({ report, errors }, null, 2)
  );
  assert.equal(errors.length, 0);
  assert.equal(
    requests.length,
    0,
    "simulated packs must not call the reward API"
  );
  assert.ok(report[4].nodes <= report[0].nodes + 40, JSON.stringify(report));
  assert.ok(
    report[4].jsEventListeners <= report[0].jsEventListeners + 40,
    JSON.stringify(report)
  );
  assert.ok(
    report[4].heap.usedSize <= report[0].heap.usedSize * 1.2,
    JSON.stringify(report)
  );
} finally {
  socket?.close();
  browser.kill();
}
