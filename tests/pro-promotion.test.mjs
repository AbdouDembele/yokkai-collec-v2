import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { intl } from "./helpers/i18n.mjs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const require = createRequire(import.meta.url);
function load(file, mocks = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true
      }
    }).outputText,
    {
      exports,
      AbortController,
      ...globals,
      require: name => {
        if (name === "next-intl") return intl;
        if (name in mocks) return mocks[name];
        if (name.endsWith(".css")) return {};
        if (name === "@/components/ui")
          return {
            Button: ({ children, ...props }) =>
              React.createElement("button", props, children),
            Modal: ({ open, children }) =>
              open ? React.createElement("div", null, children) : null
          };
        if (name === "next/link")
          return {
            __esModule: true,
            default: ({ children, ...props }) =>
              React.createElement("a", props, children)
          };
        if (name === "@/lib/ui/pro-promotion")
          return load("lib/ui/pro-promotion.ts", {}, globals);
        return require(name);
      }
    }
  );
  return exports;
}
test("Boosters dismissal lasts only the current local calendar day and rejects invalid or future values", () => {
  const { proPromotionDismissed, proPromotionNextDay } = load(
    "lib/ui/pro-promotion.ts"
  );
  const now = new Date(2026, 9, 21, 23, 59, 59, 999).getTime();
  const midnight = new Date(2026, 9, 22).getTime();
  assert.equal(proPromotionNextDay(now), midnight);
  for (const value of [
    null,
    "",
    " ",
    "invalid",
    "NaN",
    "Infinity",
    "-1",
    "0",
    String(now + 1)
  ])
    assert.equal(proPromotionDismissed(value, now), false);
  assert.equal(proPromotionDismissed(String(now), now), true);
  assert.equal(
    proPromotionDismissed(String(new Date(2026, 9, 21).getTime()), now),
    true
  );
  assert.equal(
    proPromotionDismissed(String(new Date(2026, 9, 21).getTime() - 1), now),
    false
  );
  assert.equal(proPromotionDismissed(String(now), midnight), false);
  assert.equal(proPromotionDismissed(String(now), midnight + 1), false);
  assert.equal(
    proPromotionNextDay(new Date(2026, 11, 31, 12).getTime()),
    new Date(2027, 0, 1).getTime()
  );
  // Paris and New York daylight-saving transition dates, also valid in UTC.
  for (const [year, month, day] of [
    [2026, 2, 29],
    [2026, 9, 25],
    [2026, 2, 8],
    [2026, 10, 1]
  ]) {
    const start = new Date(year, month, day).getTime();
    const next = new Date(year, month, day + 1).getTime();
    assert.equal(proPromotionNextDay(start), next);
    assert.equal(proPromotionDismissed(String(start), next - 1), true);
    assert.equal(proPromotionDismissed(String(start), next), false);
  }
});

test("banner has a single offer link, an accessible close action and no checkout or urgency", () => {
  const { ProPromotionBanner } = load("components/pro-promotion.tsx", {
    "@/components/pro-access": { useProMembershipStatus: () => null }
  });
  const html = renderToStaticMarkup(
    React.createElement(ProPromotionBanner, { onDismiss() {} })
  );
  assert.match(html, /aria-label="Discover Yokkai Pro"/);
  assert.match(html, /Make it yours/);
  assert.match(html, /Your images\. Your GIFs/);
  assert.match(html, /A bigger pack reserve/);
  assert.equal((html.match(/href="\/premium"/g) || []).length, 1);
  assert.match(html, /aria-label="Hide Pro promotion until tomorrow"/);
  assert.doesNotMatch(
    html,
    /checkout|limited.time|last.chance|role="dialog"|autofocus|€|\$/i
  );
});

function harness(initialStatus) {
  let now = Date.now(),
    timerId = 0;
  class Clock extends Date {
    static now() {
      return now;
    }
  }
  let status = initialStatus,
    visible = false,
    effect,
    storageBlocked = false;
  const storage = new Map(),
    timers = new Map(),
    listeners = new Map(),
    documentListeners = new Map();
  const document = {
    visibilityState: "visible",
    addEventListener: (key, fn) => documentListeners.set(key, fn),
    removeEventListener: key => documentListeners.delete(key)
  };
  const fakeReact = {
    ...React,
    useState: () => [
      visible,
      next => {
        visible = next;
      }
    ],
    useEffect: fn => {
      effect = fn;
    }
  };
  const { ProPromotion } = load(
    "components/pro-promotion.tsx",
    {
      react: fakeReact,
      "@/components/pro-access": { useProMembershipStatus: () => status }
    },
    {
      Date: Clock,
      document,
      localStorage: {
        getItem: key => {
          if (storageBlocked) throw Error("blocked");
          return storage.get(key) ?? null;
        },
        setItem: (key, value) => {
          if (storageBlocked) throw Error("blocked");
          storage.set(key, value);
        }
      },
      window: {
        setTimeout: (fn, delay) => {
          timers.set(++timerId, { fn, delay });
          return timerId;
        },
        clearTimeout: id => timers.delete(id),
        addEventListener: (key, fn) => listeners.set(key, fn),
        removeEventListener: key => listeners.delete(key)
      }
    }
  );
  return {
    render: (enabled = true, dismissible = true, compact = false) =>
      ProPromotion({ enabled, dismissible, compact }),
    start: () => effect(),
    flush: () => {
      const scheduled = [...timers.values()];
      timers.clear();
      for (const { fn } of scheduled) fn();
    },
    storage,
    listeners,
    timers,
    document,
    documentListeners,
    get now() {
      return now;
    },
    setNow: value => {
      now = value;
    },
    setStatus: value => {
      status = value;
    },
    block: () => {
      storageBlocked = true;
    }
  };
}
test("promotion waits for verified Basic status and never flashes for Pro, anonymous or unknown status", () => {
  for (const status of [null, true]) {
    const s = harness(status);
    assert.equal(s.render(), null);
    s.start();
    s.flush();
    assert.equal(s.render(), null);
    assert.equal(s.listeners.size, 0);
  }
  const s = harness(false);
  assert.equal(s.render(), null);
  const stop = s.start();
  s.flush();
  assert.ok(s.render());
  s.setStatus(true);
  assert.equal(s.render(), null);
  s.setStatus(null);
  assert.equal(s.render(), null);
  stop();
  assert.equal(s.listeners.size, 0);
  const disabled = harness(false);
  assert.equal(disabled.render(false), null);
  disabled.start();
  disabled.flush();
  assert.equal(disabled.render(false), null);
});

test("Boosters returns at midnight in an open tab and rechecks on return from a suspended tab", () => {
  const s = harness(false);
  const before = new Date(2026, 9, 21, 23, 59, 59).getTime();
  s.setNow(before);
  s.render();
  const stop = s.start();
  s.flush();
  assert.ok(s.render());
  assert.equal([...s.timers.values()][0].delay, 1000);
  s.render().props.onDismiss();
  assert.equal(s.render(), null);
  s.setNow(before + 1000);
  s.flush();
  assert.ok(s.render(), "Midnight timer reveals the banner without reload");
  s.render().props.onDismiss();
  assert.equal(s.render(), null);
  s.setNow(new Date(2026, 9, 23).getTime());
  s.listeners.get("focus")();
  assert.ok(s.render());
  s.render().props.onDismiss();
  assert.equal(s.render(), null);
  s.document.visibilityState = "hidden";
  s.setNow(new Date(2026, 9, 24).getTime());
  s.documentListeners.get("visibilitychange")();
  assert.equal(s.render(), null);
  s.document.visibilityState = "visible";
  s.documentListeners.get("visibilitychange")();
  assert.ok(s.render());
  stop();
  assert.equal(s.timers.size, 0);
  assert.equal(s.listeners.size, 0);
  assert.equal(s.documentListeners.size, 0);
});
test("dismissal persists, syncs between tabs, and stays closable when storage is blocked", () => {
  const key = "yokkai:pro-promotion:v1:dismissed-at";
  const s = harness(false);
  s.render();
  const stop = s.start();
  s.flush();
  s.render().props.onDismiss();
  assert.equal(s.render(), null);
  assert.ok(Number(s.storage.get(key)) > 0);
  s.storage.delete(key);
  s.listeners.get("storage")({ key });
  assert.ok(s.render());
  s.storage.set(key, String(s.now));
  s.listeners.get("storage")({ key });
  assert.equal(s.render(), null);
  stop();
  const blocked = harness(false);
  blocked.block();
  blocked.render();
  blocked.start();
  blocked.flush();
  assert.ok(blocked.render());
  blocked.render().props.onDismiss();
  assert.equal(blocked.render(), null);
});
test("integration reuses membership request and only advertises on Home and Boosters with closing on Boosters only", () => {
  const source = readFileSync("components/pro-access.tsx", "utf8");
  assert.match(
    source,
    /setMembership\(\s*typeof result\?\.active === "boolean" \? result\.active : null\s*\)/
  );
  assert.equal(
    (source.match(/fetch\("\/api\/pro\/benefits"/g) || []).length,
    1
  );
  assert.doesNotMatch(
    readFileSync("components/pro-promotion.tsx", "utf8"),
    /fetch\(|checkout|createClient/
  );
  const boosters = readFileSync("components/boosters.tsx", "utf8");
  assert.doesNotMatch(
    readFileSync("components/game.tsx", "utf8"),
    /<ProPromotion/
  );
  assert.match(
    boosters.replace(/\s+/g, " "),
    /!opening && !revealing && <ReferralReminder packChoices \/>/
  );
  const topbar = readFileSync("components/topbar.tsx", "utf8");
  assert.match(
    topbar,
    /<ProPromotion\s+enabled=\{secondaryReady && view === "home"\}\s+dismissible=\{false\}/
  );
});

test("Home stays visible without a close action even after the Boosters banner was dismissed", () => {
  const s = harness(false);
  s.storage.set("yokkai:pro-promotion:v1:dismissed-at", String(Date.now()));
  const home = s.render(true, false);
  assert.ok(home);
  assert.equal(home.props.onDismiss, undefined);
  s.start();
  assert.equal(s.timers.size, 0);
  assert.equal(s.listeners.size, 0);
  s.block();
  assert.ok(s.render(true, false));
  s.setStatus(true);
  assert.equal(s.render(true, false), null);
  s.setStatus(null);
  assert.equal(s.render(true, false), null);
  s.setStatus(false);
  assert.equal(s.render(false, false), null);
  const { ProPromotionBanner } = load("components/pro-promotion.tsx", {
    "@/components/pro-access": { useProMembershipStatus: () => null }
  });
  const html = renderToStaticMarkup(React.createElement(ProPromotionBanner));
  assert.match(html, /href="\/premium"/);
  assert.doesNotMatch(html, /<button|Hide Pro promotion/);
  assert.equal(
    s.render(true),
    null,
    "Boosters still honors its dismissal preference"
  );
});

test("membership status distinguishes Basic, Pro without profile style, and unavailable responses", async () => {
  for (const scenario of [
    { active: false, expected: false },
    { active: true, expected: true },
    { active: "false", expected: null },
    { active: null, expected: null },
    { active: false, unavailable: true, expected: null },
    { active: false, offline: true, expected: null }
  ]) {
    let effect,
      index = 0;
    const states = [];
    const react = {
      ...React,
      useEffect: fn => {
        effect = fn;
      },
      useState: initial => {
        const current = index++;
        states[current] = initial;
        return [
          initial,
          value => {
            states[current] = value;
          }
        ];
      }
    };
    const window = {
      setTimeout: () => 1,
      clearTimeout() {},
      setInterval: () => 2,
      clearInterval() {},
      addEventListener() {},
      removeEventListener() {}
    };
    const document = {
      visibilityState: "visible",
      addEventListener() {},
      removeEventListener() {}
    };
    const { ProAccessProvider } = load(
      "components/pro-access.tsx",
      {
        react,
        "@/lib/ui/profile-style": {
          DEFAULT_PROFILE_STYLE: {},
          normalizeProfileStyle: value => value
        }
      },
      {
        window,
        document,
        fetch: async path => {
          if (scenario.offline) throw Error("offline");
          return {
            ok: path.endsWith("benefits") && !scenario.unavailable,
            json: async () => ({ active: scenario.active })
          };
        }
      }
    );
    ProAccessProvider({ children: null });
    assert.equal(states[2], null);
    const stop = effect();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(states[2], scenario.expected, JSON.stringify(scenario));
    assert.equal(
      states[0],
      false,
      "Unavailable profile style must not grant customization access"
    );
    stop();
  }
});

test("empty pack promotion is a single compact Pro link without a banner or close action", () => {
  const s = harness(false);
  const html = renderToStaticMarkup(s.render(true, false, true));
  assert.match(html, /<button[^>]*>Get more packs<\/button>/);
  assert.doesNotMatch(html, /yk-pro-promo|<aside/);
  assert.equal(harness(true).render(true, false, true), null);
});
