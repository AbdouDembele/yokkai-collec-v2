import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { reapplyJournal } from "../scripts/reapply-account-deletions.mjs";

const loaded = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(
    readFileSync(
      new URL("../lib/billing/deletion.ts", import.meta.url),
      "utf8"
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true
      }
    }
  ).outputText,
  {
    module: loaded,
    exports: loaded.exports,
    Date,
    Set,
    require: name =>
      ({
        "server-only": {},
        stripe: {},
        "./config": { BillingError: Error },
        "./store": {}
      })[name]
  }
);
const { cancelAccountBilling } = loaded.exports;
const user = "10000000-0000-4000-8000-000000000001";
const entry = { user_id: user, deleted_at: "2026-10-11T10:00:00Z" };
const config = { account: "acct_fixture", price: "price_fixture", live: false };

for (const kind of [
  "active subscription",
  "customer without subscription",
  "Stripe error",
  "no billing"
]) {
  test(`restoration: ${kind}`, async () => {
    const calls = [];
    let confirmed = kind === "no billing";
    const subscription = {
      id: "sub_fixture",
      customer: "cus_fixture",
      livemode: false,
      status: "active",
      items: {
        has_more: false,
        data: [{ price: { id: config.price }, quantity: 1 }]
      }
    };
    const stripe = {
      accounts: {
        retrieve: async () => {
          calls.push("stripe");
          if (kind === "Stripe error") throw Error("SECRET_PROVIDER_DETAIL");
          return { id: config.account };
        }
      },
      checkout: {
        sessions: { list: async () => ({ data: [], has_more: false }) }
      },
      subscriptions: {
        list: async () => ({
          data: kind === "active subscription" ? [subscription] : [],
          has_more: false
        }),
        retrieve: async () => subscription,
        cancel: async (id, options) => {
          assert.equal(id, subscription.id);
          assert.equal(options.invoice_now, false);
          assert.equal(options.prorate, false);
          calls.push("cancel");
          return { ...subscription, status: "canceled" };
        }
      }
    };
    const store = {
      claimDeletion: async id => {
        assert.equal(id, user);
        return { stripe_customer_id: "cus_fixture" };
      },
      confirmDeletion: async () => {
        calls.push("confirm");
        confirmed = true;
      },
      release: async () => calls.push("release")
    };
    const admin = {
      rpc: async name => {
        calls.push(name);
        return name === "prepare_account_deletion"
          ? confirmed
            ? { data: [{ bucket: "avatars", name: `${user}/avatar.png` }] }
            : { error: { message: "BILLING_CANCELLATION_REQUIRED" } }
          : {};
      },
      storage: {
        from: () => ({
          remove: async () => {
            calls.push("storage");
            return {};
          }
        })
      },
      auth: {
        admin: {
          deleteUser: async (id, soft) => {
            assert.equal(id, user);
            assert.equal(soft, false);
            calls.push("auth");
            return {};
          }
        }
      },
      from: () => ({
        update: value => {
          assert.equal(value.deleted_at, entry.deleted_at);
          return {
            eq: () => ({
              gt: async () => {
                calls.push("date");
                return {};
              }
            })
          };
        }
      })
    };
    const apply = () =>
      reapplyJournal(admin, [entry, entry], id =>
        cancelAccountBilling(id, config, stripe, store)
      );
    if (kind === "Stripe error") {
      await assert.rejects(apply(), {
        message: `REAPPLICATION_STOPPED: ${user} (no automatic retry)`
      });
      assert.deepEqual(calls, [
        "begin_account_deletion",
        "prepare_account_deletion",
        "stripe",
        "release"
      ]);
    } else {
      await reapplyJournal(admin, [entry], id =>
        cancelAccountBilling(id, config, stripe, store)
      );
      assert.deepEqual(
        calls,
        kind === "no billing"
          ? [
              "begin_account_deletion",
              "prepare_account_deletion",
              "storage",
              "auth",
              "date"
            ]
          : [
              "begin_account_deletion",
              "prepare_account_deletion",
              "stripe",
              ...(kind === "active subscription" ? ["cancel"] : []),
              "confirm",
              "release",
              "prepare_account_deletion",
              "storage",
              "auth",
              "date"
            ]
      );
    }
  });
}

test("administrative loader reuses the server adapter and rejects missing configuration before network access", async () => {
  const { spawnSync } = await import("node:child_process");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !name.startsWith("STRIPE_") &&
        !name.startsWith("SUPABASE_") &&
        !name.startsWith("NEXT_PUBLIC_")
    )
  );
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from "node:assert/strict";
    import { loadRestorationBilling } from "./scripts/restoration-billing.mjs";
    globalThis.fetch = () => { throw Error("UNEXPECTED_NETWORK"); };
    const cancel = await loadRestorationBilling();
    await assert.rejects(cancel("${user}"), { message: "BILLING_CONFIGURATION" });
  `
    ],
    {
      cwd: new URL("../", import.meta.url),
      env,
      encoding: "utf8",
      timeout: 15000
    }
  );
  assert.equal(result.status, 0, result.stderr);
});
