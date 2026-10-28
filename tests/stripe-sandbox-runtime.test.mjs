import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import { PassThrough } from "node:stream";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import {
  startStripeSandbox,
  localSupabaseValues,
  webhookSecretFromListener,
  SANDBOX_ORIGIN,
  SANDBOX_EVENTS
} from "../scripts/start-stripe-sandbox.mjs";

const env = Object.freeze({
  NODE_ENV: "development",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  STRIPE_BILLING_MODE: "test",
  STRIPE_BILLING_ENABLED: "false",
  STRIPE_CHECKOUT_ENABLED: "false",
  STRIPE_SECRET_KEY: "rk_test_example",
  STRIPE_ACCOUNT_ID: "acct_example",
  STRIPE_PRO_PRICE_ID: "price_example"
});
const local =
  'API_URL="http://127.0.0.1:54321"\nPUBLISHABLE_KEY="sb_publishable_example"\nSECRET_KEY="sb_secret_example"';
// Synthetic per-run fixture; never a credential issued by Stripe.
const signingSecret = "whsec_" + randomBytes(32).toString("hex");
const createStripe = () => ({
  accounts: { retrieve: async () => ({ id: env.STRIPE_ACCOUNT_ID }) },
  prices: {
    retrieve: async () => ({
      id: env.STRIPE_PRO_PRICE_ID,
      livemode: false,
      active: true,
      type: "recurring",
      unit_amount: 499,
      currency: "eur",
      recurring: {
        interval: "month",
        interval_count: 1,
        usage_type: "licensed"
      }
    })
  }
});

function child() {
  const value = new EventEmitter();
  value.stdout = new PassThrough();
  value.stderr = new PassThrough();
  value.exitCode = null;
  value.kill = () => {
    if (value.exitCode === null) {
      value.exitCode = 0;
      value.emit("exit", 0);
    }
  };
  return value;
}

test("Sandbox launcher keeps keys out of argv and output, forwards to loopback and enables checkout only in the local child", async t => {
  const calls = [],
    logs = [],
    cli = child(),
    app = child();
  const runtime = await startStripeSandbox(env, {
    createStripe,
    readSupabase: () => local,
    log: line => logs.push(line),
    spawnProcess: (command, args, options) => {
      calls.push({ command, args, options });
      if (calls.length === 1) {
        queueMicrotask(() => cli.stderr.write(`Ready! ${signingSecret}\n`));
        return cli;
      }
      return app;
    }
  });
  t.after(runtime.stop);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].args.includes(`${SANDBOX_ORIGIN}/api/billing/webhook`));
  assert.ok(calls[0].args.includes("@self"));
  assert.ok(calls[0].args.includes("--events"));
  assert.ok(calls[0].args.includes(SANDBOX_EVENTS.join(",")));
  assert.ok(!calls[0].args.includes("--live"));
  assert.equal(calls[0].options.env.STRIPE_API_KEY, env.STRIPE_SECRET_KEY);
  for (const call of calls) {
    assert.equal(call.options.windowsHide, true);
    assert.doesNotMatch(
      JSON.stringify(call.args),
      /rk_test_example|whsec_|sb_secret_/
    );
  }
  const launched = calls[1].options.env;
  assert.ok(calls[1].args.includes("--webpack"));
  assert.equal(launched.STRIPE_BILLING_MODE, "test");
  assert.equal(launched.STRIPE_BILLING_ENABLED, "true");
  assert.equal(launched.STRIPE_CHECKOUT_ENABLED, "true");
  assert.equal(launched.STRIPE_SANDBOX_PREVIEW, "true");
  assert.equal(launched.STRIPE_PRO_WEBHOOK_SECRET, signingSecret);
  assert.equal(launched.NEXT_PUBLIC_SITE_URL, SANDBOX_ORIGIN);
  assert.equal(launched.NEXT_PUBLIC_SUPABASE_URL, "http://127.0.0.1:54321");
  assert.equal(env.STRIPE_BILLING_ENABLED, "false");
  assert.equal(env.STRIPE_CHECKOUT_ENABLED, "false");
  app.stdout.write(`Ready in 200ms ${env.STRIPE_SECRET_KEY}`);
  cli.stderr.write(
    `[200] POST ${SANDBOX_ORIGIN}/api/billing/webhook [evt_example]\n`
  );
  assert.ok(logs.includes("STRIPE_SANDBOX_WEBHOOK_DELIVERED"));
  assert.doesNotMatch(logs.join("\n"), /rk_test_|whsec_|sb_secret_/);
  const eventSource = readFileSync(
    new URL("../lib/billing/subscription.ts", import.meta.url),
    "utf8"
  );
  const eventList = eventSource.match(
    /BILLING_EVENTS = new Set\(\[([\s\S]*?)\]\)/
  )?.[1];
  assert.ok(eventList);
  assert.deepEqual(
    SANDBOX_EVENTS,
    [...eventList.matchAll(/"([a-z_.]+)"/g)].map(match => match[1])
  );
});

test("Sandbox launcher refuses production settings, live keys and remote databases before starting processes", async () => {
  for (const change of [
    { NODE_ENV: "production" },
    { STRIPE_SECRET_KEY: "rk_live_example" },
    { STRIPE_BILLING_MODE: "live" }
  ]) {
    await assert.rejects(
      startStripeSandbox(
        { ...env, ...change },
        {
          createStripe,
          readSupabase: () =>
            assert.fail("No database configuration for unsafe Stripe settings"),
          spawnProcess: () => assert.fail("No process for unsafe settings")
        }
      ),
      /STRIPE_SANDBOX_CONFIGURATION_INVALID/
    );
  }
  for (const text of [
    local.replace("127.0.0.1", "db.example.com"),
    local.replace("http:", "https:"),
    local.replace("127.0.0.1", "localhost.evil.example"),
    'API_URL="http://127.0.0.1:54321"'
  ]) {
    await assert.rejects(
      startStripeSandbox(env, {
        createStripe,
        readSupabase: () => text,
        spawnProcess: () => assert.fail("No process for remote database")
      }),
      /STRIPE_SANDBOX_LOCAL_DATABASE_REQUIRED/
    );
  }
  assert.equal(
    localSupabaseValues(local).NEXT_PUBLIC_SUPABASE_URL,
    "http://127.0.0.1:54321"
  );
});

test("CLI signing secrets are collected across chunks without logging them; failed listeners never start the app", async () => {
  const cli = child(),
    logs = [];
  const promise = webhookSecretFromListener(cli, line => logs.push(line));
  cli.stderr.write(`Ready! ${signingSecret.slice(0, 24)}`);
  let complete = false;
  promise.then(() => {
    complete = true;
  });
  await Promise.resolve();
  assert.equal(complete, false);
  cli.stderr.write(`${signingSecret.slice(24)}\n`);
  assert.equal(await promise, signingSecret);
  assert.equal(logs.length, 0);
  cli.kill();
  let spawned = 0;
  await assert.rejects(
    startStripeSandbox(env, {
      createStripe,
      readSupabase: () => local,
      log: line => logs.push(line),
      spawnProcess: () => {
        spawned++;
        const failure = child();
        queueMicrotask(() => {
          failure.stderr.write("permission denied rk_test_sensitive_payload");
          failure.exitCode = 1;
          failure.emit("exit", 1);
        });
        return failure;
      }
    }),
    /STRIPE_SANDBOX_LISTENER_UNAVAILABLE/
  );
  assert.equal(spawned, 1);
  assert.doesNotMatch(logs.join("\n"), /sensitive|rk_test_|whsec_/);
});

test("billing preview requires an explicitly enabled development-only test app with loopback Supabase", () => {
  const load = (path, dependencies) => {
    const loaded = { exports: {} };
    const output = ts.transpileModule(
      readFileSync(new URL("../" + path, import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022
        }
      }
    ).outputText;
    vm.runInNewContext(output, {
      module: loaded,
      exports: loaded.exports,
      URL,
      process: { env: {} },
      require: name => {
        if (name === "server-only") return {};
        assert.ok(name in dependencies, name);
        return dependencies[name];
      }
    });
    return loaded.exports;
  };
  const config = load("lib/billing/config.ts", {});
  const { billingSandboxEnabled } = load("lib/billing/sandbox.ts", {
    "./config": config
  });
  const valid = {
    ...env,
    STRIPE_BILLING_ENABLED: "true",
    STRIPE_CHECKOUT_ENABLED: "true",
    STRIPE_SANDBOX_PREVIEW: "true",
    STRIPE_PRO_WEBHOOK_SECRET: signingSecret,
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SECRET_KEY: "local_server_key"
  };
  assert.equal(billingSandboxEnabled(valid), true);
  for (const change of [
    { NODE_ENV: "production" },
    { STRIPE_SANDBOX_PREVIEW: undefined },
    { STRIPE_BILLING_ENABLED: "false" },
    { STRIPE_CHECKOUT_ENABLED: "false" },
    { STRIPE_BILLING_MODE: "live" },
    { STRIPE_SECRET_KEY: "rk_live_example" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://db.example.com" },
    { STRIPE_PRO_WEBHOOK_SECRET: "" }
  ]) {
    assert.equal(billingSandboxEnabled({ ...valid, ...change }), false);
  }
  const preview = readFileSync(
    new URL("../app/design-system/billing-preview/page.tsx", import.meta.url),
    "utf8"
  );
  assert.ok(
    preview.indexOf("if (!billingSandboxEnabled()) notFound()") <
      preview.indexOf("const user = await getCurrentUser()")
  );
  const callback = readFileSync(
    new URL("../app/premium/page.tsx", import.meta.url),
    "utf8"
  );
  if (callback.includes("PremiumOffer")) {
    // The public sales page is not the Sandbox lab. It may display the offer,
    // but management remains authenticated and purchases remain server-gated.
    assert.match(callback, /getCurrentUser\(\)/);
    assert.match(callback, /getBillingSettings\(user\.id\)/);
    assert.match(callback, /\/settings#subscription/);
    assert.doesNotMatch(
      callback,
      /design-system\/billing-preview|localPremiumEnabled/
    );
  } else {
    assert.match(callback, /if \(!billingSandboxEnabled\(\)\) notFound\(\)/);
    assert.match(callback, /redirect\("\/design-system\/billing-preview"\)/);
  }
});
