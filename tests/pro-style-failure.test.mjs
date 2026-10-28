import { intl, gameMessages } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const flush = () => new Promise(resolve => setImmediate(resolve));
const reply = data => ({ ok: true, json: async () => data });

function harness() {
  const states = [],
    listeners = new Map(),
    timeouts = new Map();
  let stateIndex = 0,
    effect,
    timerId = 0,
    saveButton;
  let benefits = () => reply({ active: true });
  let style = () => reply({ active: true, style: { effect: "neon" } });
  const calls = [];
  const window = {
    setTimeout: fn => {
      const id = ++timerId;
      timeouts.set(id, fn);
      return id;
    },
    clearTimeout: id => timeouts.delete(id),
    setInterval: () => ++timerId,
    clearInterval() {},
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name)
  };
  const document = {
    visibilityState: "visible",
    addEventListener: window.addEventListener,
    removeEventListener: window.removeEventListener
  };
  const react = {
    ...React,
    useState: initial => {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [
        states[index],
        value => {
          states[index] = value;
        }
      ];
    },
    useEffect: fn => {
      effect ??= fn;
    }
  };
  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const loaded = { exports: {} };
    modules.set(filename, loaded);
    let source = readFileSync(resolve(filename), "utf8");
    if (filename === "components/profile.tsx") {
      // Execute the actual isolated editor, not a reimplementation of its state
      // or save guard. Other profile tabs and their adapters are out of scope.
      const start = source.indexOf("function ProfileStyleEditor(");
      const end = source.indexOf("\nconst wishlistRarities", start);
      assert.ok(start > 0 && end > start);
      source = `import { useState } from "react";
        import { useTranslations } from "next-intl";
        import { gameErrorKey } from "@/i18n/game-messages";
        import { useProAccess, useProMembershipStatus } from "@/components/pro-access";
        import { DEFAULT_PROFILE_STYLE, normalizeProfileStyle } from "@/lib/ui/profile-style";
        import { ProfileStyleFields } from "@/components/profile-style-fields";
        import { Button } from "@/components/ui";
        export ${source.slice(start, end)}`;
    }
    vm.runInNewContext(
      ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true
        }
      }).outputText,
      {
        module: loaded,
        exports: loaded.exports,
        URL,
        AbortController,
        window,
        document,
        fetch: async (path, options) => {
          calls.push({ path, options });
          return path.endsWith("benefits") ? benefits(options) : style(options);
        },
        require: id => {
          if (id === "next-intl") return intl;
          if (id === "@/i18n/game-messages") return gameMessages;
          if (id === "react") return react;
          if (id === "next/link")
            return {
              __esModule: true,
              default: ({ children, ...props }) =>
                React.createElement("a", props, children)
            };
          if (id === "@/components/ui")
            return {
              Button: ({ children, ...props }) => {
                delete props.variant;
                if (props.onClick) saveButton = props;
                return React.createElement("button", props, children);
              }
            };
          if (id.startsWith("@/lib/ui/")) return load(id.slice(2) + ".ts");
          if (id.startsWith("@/components/")) return load(id.slice(2) + ".tsx");
          return require(id);
        }
      }
    );
    return loaded.exports;
  }
  const access = load("components/pro-access.tsx");
  const { ProfileStyleEditor } = load("components/profile.tsx");
  function Status() {
    return React.createElement("output", {
      "data-membership": String(access.useProMembershipStatus()),
      "data-customization": String(access.useProAccess()),
      "data-style": access.useOwnProfileStyle()?.effect ?? "none"
    });
  }
  const children = React.createElement(
    React.Fragment,
    null,
    React.createElement(Status),
    React.createElement(ProfileStyleEditor, {
      profile: { pseudo: "Owner" },
      onSaved() {},
      onClose() {}
    }),
    React.createElement(access.ProFeatureNotice, {
      feature: "Custom card artwork"
    })
  );
  const render = () => {
    stateIndex = 0;
    return renderToStaticMarkup(access.ProAccessProvider({ children }));
  };
  render();
  return {
    render,
    start: () => effect(),
    calls,
    listeners,
    timeouts,
    document,
    button: () => saveButton,
    benefits: fn => {
      benefits = fn;
    },
    style: fn => {
      style = fn;
    }
  };
}

for (const failure of [
  "http",
  "network",
  "json",
  "timeout",
  "inactive",
  "forged"
]) {
  test(`confirmed Pro remains Pro when profile style fails: ${failure}`, async () => {
    const h = harness();
    h.style(({ signal }) => {
      if (failure === "network") throw Error("offline");
      if (failure === "json")
        return {
          ok: true,
          json: async () => {
            throw Error("invalid JSON");
          }
        };
      if (failure === "timeout")
        return new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(Error("aborted")), {
            once: true
          });
        });
      if (failure === "forged") return reply({ active: "true" });
      return failure === "inactive" ? reply({ active: false }) : { ok: false };
    });
    const stop = h.start();
    await flush();
    if (failure === "timeout") {
      for (const expire of [...h.timeouts.values()]) expire();
      await flush();
    }
    const html = h.render();
    assert.match(html, /data-membership="true"/);
    assert.match(html, /data-customization="false"/);
    assert.match(html, /PRO ACTIVE/);
    assert.match(html, /Profile style unavailable/);
    assert.match(html, /data-style="none"/);
    assert.doesNotMatch(
      html,
      /PREVIEW ONLY|until you upgrade|Discover Yokkai Pro|Pro required|Upgrade to Yokkai Pro/
    );
    assert.equal(h.button().disabled, true);
    h.button().onClick();
    await flush();
    assert.ok(
      h.calls.every(call => !call.options.method),
      "No mutation while customization is unavailable"
    );
    assert.equal(
      h.calls.filter(call => call.path.endsWith("benefits")).length,
      1
    );
    assert.ok(h.calls.every(call => call.options.cache === "no-store"));
    stop();
    assert.equal(h.listeners.size, 0);
  });
}

test("membership is published before a slow style; style recovery and Basic transition remain server-driven", async () => {
  const h = harness();
  let complete;
  h.style(
    () =>
      new Promise(resolve => {
        complete = resolve;
      })
  );
  const stop = h.start();
  await flush();
  assert.match(h.render(), /data-membership="true"/);
  assert.match(h.render(), /data-customization="false"/);
  complete(reply({ active: true, style: { effect: "neon" } }));
  await flush();
  assert.match(h.render(), /data-customization="true"/);
  assert.match(h.render(), /data-style="neon"/);
  assert.equal(h.button().disabled, false);
  assert.doesNotMatch(h.render(), /Profile style unavailable|PREVIEW ONLY/);
  h.benefits(() => reply({ active: false }));
  h.listeners.get("focus")();
  await flush();
  const html = h.render();
  assert.match(html, /data-membership="false"/);
  assert.match(html, /data-customization="false"/);
  assert.match(html, /PREVIEW ONLY/);
  assert.equal(h.button().disabled, true);
  assert.match(html, /Discover Yokkai Pro/);
  assert.equal(
    h.calls.filter(call => call.path.endsWith("profile-style")).length,
    1
  );
  stop();
});

for (const failure of ["http", "network", "json", "forged"]) {
  test(`untrusted or unavailable membership is unknown, never Basic or Pro: ${failure}`, async () => {
    const h = harness();
    const stop = h.start();
    await flush();
    assert.match(h.render(), /data-membership="true"/);
    h.benefits(() => {
      if (failure === "network") throw Error("offline");
      if (failure === "json")
        return {
          ok: true,
          json: async () => {
            throw Error("invalid JSON");
          }
        };
      return failure === "forged" ? reply({ active: "true" }) : { ok: false };
    });
    h.listeners.get("online")();
    await flush();
    const html = h.render();
    assert.match(html, /data-membership="null"/);
    assert.match(html, /data-customization="false"/);
    assert.match(html, /STATUS UNAVAILABLE/);
    assert.equal(h.button().disabled, true);
    assert.doesNotMatch(html, /PRO ACTIVE|PREVIEW ONLY|Discover Yokkai Pro/);
    stop();
  });
}

test("an unmounted provider ignores a late style response", async () => {
  const h = harness();
  let complete;
  h.style(
    () =>
      new Promise(resolve => {
        complete = resolve;
      })
  );
  const stop = h.start();
  await flush();
  stop();
  complete(reply({ active: true, style: { effect: "neon" } }));
  await flush();
  assert.match(h.render(), /data-customization="false"/);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.timeouts.size, 0);
});

test("a failed style refresh clears the old cosmetics without downgrading Pro", async () => {
  const h = harness();
  const stop = h.start();
  await flush();
  assert.match(h.render(), /data-style="neon"/);
  h.style(() => ({ ok: false }));
  h.listeners.get("focus")();
  await flush();
  const html = h.render();
  assert.match(html, /data-membership="true"/);
  assert.match(html, /data-customization="false"/);
  assert.match(html, /data-style="none"/);
  assert.match(html, /PRO ACTIVE/);
  stop();
});
