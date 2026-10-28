import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);

function loadPremiumCheckout(react = React, globals = {}) {
  const loaded = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(
        new URL("../components/premium-checkout.tsx", import.meta.url),
        "utf8"
      ),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true
        }
      }
    ).outputText,
    {
      exports: loaded.exports,
      module: loaded,
      URL,
      ...globals,
      require: name => {
        if (name === "react") return react;
        if (name === "react/jsx-runtime") return require(name);
        if (name === "next/link")
          return {
            __esModule: true,
            default: ({ children, ...props }) =>
              React.createElement("a", props, children)
          };
        assert.fail(`Unexpected dependency: ${name}`);
      }
    }
  );
  return loaded.exports.PremiumCheckout;
}

const status = {
  active: false,
  status: "not_subscribed",
  endsAt: null,
  cancelAtPeriodEnd: false,
  hasCustomer: false
};
const billing = {
  enabled: true,
  checkoutEnabled: true,
  sandbox: false,
  status,
  unavailable: false
};

test("Premium CTA keeps signed-out and existing-customer flows safe", () => {
  const PremiumCheckout = loadPremiumCheckout();
  const signedOut = renderToStaticMarkup(
    React.createElement(PremiumCheckout, { signedIn: false, billing: null })
  );
  assert.match(signedOut, /href="\/login\?next=%2Fpremium"/);
  assert.match(signedOut, />GET PRO</);

  const customer = renderToStaticMarkup(
    React.createElement(PremiumCheckout, {
      signedIn: true,
      billing: {
        ...billing,
        status: { ...status, active: true, hasCustomer: true }
      }
    })
  );
  assert.match(customer, /href="\/settings#subscription"/);
  assert.match(customer, />Manage subscription</);
  assert.doesNotMatch(customer, />GET PRO</);

  const inactiveCustomer = renderToStaticMarkup(
    React.createElement(PremiumCheckout, {
      signedIn: true,
      billing: {
        ...billing,
        status: { ...status, hasCustomer: true }
      }
    })
  );
  assert.match(inactiveCustomer, />GET PRO</);
  assert.doesNotMatch(inactiveCustomer, />Manage subscription</);
});

test("GET PRO posts once and redirects only to Stripe Checkout", async () => {
  let index = 0;
  let resolveResponse;
  const slots = [];
  const redirects = [];
  const requests = [];
  const react = {
    ...React,
    useState: initial => {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = initial;
      return [
        slots[slot],
        next => {
          slots[slot] = next;
        }
      ];
    },
    useRef: initial => {
      const slot = index++;
      return (slots[slot] ??= { current: initial });
    }
  };
  const PremiumCheckout = loadPremiumCheckout(react, {
    window: { location: { assign: url => redirects.push(url) } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return new Promise(resolve => {
        resolveResponse = resolve;
      });
    }
  });
  const render = () => {
    index = 0;
    return PremiumCheckout({ signedIn: true, billing });
  };
  const nodes = node =>
    Array.isArray(node)
      ? node.flatMap(nodes)
      : React.isValidElement(node)
        ? [node, ...nodes(node.props.children)]
        : [];

  const getPro = nodes(render()).find(
    node => node.props.children === "GET PRO"
  );
  getPro.props.onClick();
  getPro.props.onClick();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/billing/checkout");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.body, "{}");
  assert.equal(
    nodes(render()).find(node => node.props.children === "OPENING STRIPE…")
      .props.disabled,
    true
  );

  resolveResponse({
    ok: true,
    json: async () => ({ url: "https://checkout.stripe.com/c/pay/cs_test" })
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(redirects, ["https://checkout.stripe.com/c/pay/cs_test"]);
});

test("GET PRO rejects a lookalike checkout host", async () => {
  let index = 0;
  const slots = [];
  const redirects = [];
  const react = {
    ...React,
    useState: initial => {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = initial;
      return [
        slots[slot],
        next => {
          slots[slot] = next;
        }
      ];
    },
    useRef: initial => {
      const slot = index++;
      return (slots[slot] ??= { current: initial });
    }
  };
  const PremiumCheckout = loadPremiumCheckout(react, {
    window: { location: { assign: url => redirects.push(url) } },
    fetch: async () => ({
      ok: true,
      json: async () => ({
        url: "https://checkout.stripe.com.evil.example/session"
      })
    })
  });
  const render = () => {
    index = 0;
    return PremiumCheckout({ signedIn: true, billing });
  };
  const nodes = node =>
    Array.isArray(node)
      ? node.flatMap(nodes)
      : React.isValidElement(node)
        ? [node, ...nodes(node.props.children)]
        : [];

  nodes(render())
    .find(node => node.props.children === "GET PRO")
    .props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(redirects.length, 0);
  assert.ok(nodes(render()).some(node => node.props.role === "alert"));
});
