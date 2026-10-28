import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { deleteAccount } from "../lib/server/account-deletion-core.mjs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

class BillingError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
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
        "./config": { BillingError },
        "./store": {}
      })[name]
  }
);
const { cancelAccountBilling } = loaded.exports;
const user = "7e000000-0000-4000-8000-000000000001";
const config = { account: "acct_fixture", price: "price_fixture", live: false };
function fixture() {
  const calls = [];
  const account = {
    id: "account",
    stripe_customer_id: "cus_fixture",
    checkout_id: "cs_fixture"
  };
  let sessionStatus = "open";
  let subStatus = "active";
  const sub = () => ({
    id: "sub_fixture",
    customer: "cus_fixture",
    livemode: false,
    status: subStatus,
    items: {
      has_more: false,
      data: [{ price: { id: "price_fixture" }, quantity: 1 }]
    }
  });
  const session = () => ({
    id: "cs_fixture",
    customer: "cus_fixture",
    client_reference_id: user,
    livemode: false,
    mode: "subscription",
    status: sessionStatus,
    subscription: sessionStatus === "complete" ? "sub_fixture" : null
  });
  const stripe = {
    accounts: { retrieve: async () => ({ id: config.account }) },
    checkout: {
      sessions: {
        retrieve: async () => session(),
        expire: async () => {
          calls.push("expire");
          sessionStatus = "expired";
        },
        list: async () => ({ data: [], has_more: false })
      }
    },
    subscriptions: {
      list: async () => ({ data: [sub()], has_more: false }),
      retrieve: async () => sub(),
      cancel: async (id, options) => {
        assert.equal(id, "sub_fixture");
        assert.equal(options.invoice_now, false);
        assert.equal(options.prorate, false);
        calls.push("cancel");
        subStatus = "canceled";
        return sub();
      }
    }
  };
  const store = {
    claimDeletion: async () => account,
    confirmDeletion: async () => calls.push("confirm"),
    release: async () => calls.push("release")
  };
  return {
    account,
    stripe,
    store,
    calls,
    complete: () => {
      sessionStatus = "complete";
    }
  };
}

test("deletion expires checkout and confirms canceled billing before erasing private mappings", async () => {
  const h = fixture();
  await cancelAccountBilling(user, config, h.stripe, h.store);
  assert.deepEqual(h.calls, ["expire", "cancel", "confirm", "release"]);
});
test("a checkout completed during expiration is still canceled", async () => {
  const h = fixture();
  h.stripe.checkout.sessions.expire = async () => {
    h.complete();
    throw Error("concurrent completion");
  };
  await cancelAccountBilling(user, config, h.stripe, h.store);
  assert.deepEqual(h.calls, ["cancel", "confirm", "release"]);
});
test("uncertain intents, wrong owners, truncated lists and provider failures never confirm deletion", async () => {
  for (const change of [
    h => {
      h.account.checkout_id = null;
      h.account.checkout_started_at = new Date().toISOString();
    },
    h => {
      h.account.stripe_customer_id = null;
      h.account.customer_started_at = new Date().toISOString();
    },
    h => {
      h.stripe.accounts.retrieve = async () => ({ id: "acct_other" });
    },
    h => {
      h.stripe.checkout.sessions.retrieve = async () => ({
        customer: "cus_other"
      });
    },
    h => {
      h.stripe.subscriptions.list = async () => ({ data: [], has_more: true });
    },
    h => {
      h.stripe.subscriptions.retrieve = async () => ({
        customer: "cus_other",
        livemode: false
      });
    },
    h => {
      h.stripe.subscriptions.cancel = async () => {
        throw Error("provider secret detail");
      };
    },
    h => {
      h.stripe.subscriptions.cancel = async () => ({ status: "active" });
    }
  ]) {
    const h = fixture();
    change(h);
    await assert.rejects(cancelAccountBilling(user, config, h.stripe, h.store));
    assert.ok(!h.calls.includes("confirm"));
    assert.equal(h.calls.at(-1), "release");
  }
});
test("core preserves the committed fence and never deletes storage/Auth after billing failure", async () => {
  for (const adapter of [
    undefined,
    async () => {
      throw Error("private provider detail");
    }
  ]) {
    const calls = [];
    const admin = {
      rpc: async name => {
        calls.push(name);
        return name === "prepare_account_deletion"
          ? { error: { message: "BILLING_CANCELLATION_REQUIRED" } }
          : {};
      }
    };
    await assert.rejects(
      deleteAccount(user, admin, adapter),
      /^Error: ACCOUNT_DELETION_BILLING_(REQUIRED|FAILED)$/
    );
    assert.deepEqual(calls, [
      "begin_account_deletion",
      "prepare_account_deletion"
    ]);
  }
  const calls = [];
  let confirmed = false;
  const admin = {
    rpc: async name => {
      calls.push(name);
      return name === "prepare_account_deletion"
        ? confirmed
          ? { data: [] }
          : { error: { message: "BILLING_CANCELLATION_REQUIRED" } }
        : {};
    },
    auth: {
      admin: {
        deleteUser: async () => {
          calls.push("auth");
          return {};
        }
      }
    }
  };
  await deleteAccount(user, admin, async () => {
    calls.push("billing");
    confirmed = true;
  });
  assert.deepEqual(calls, [
    "begin_account_deletion",
    "prepare_account_deletion",
    "billing",
    "prepare_account_deletion",
    "auth"
  ]);
});

test("SQL deletion guard fences checkout, respects existing leases and restricts cancellation receipts to service role", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.query(
    'insert into auth.users(id,raw_user_meta_data) values($1,\'{"pseudo":"BillingDeletion"}\')',
    [user]
  );
  const scope = "test:acct_fixture:price_fixture";
  const account = (
    await db.query("select public.billing_claim($1,$2) value", [user, scope])
  ).rows[0].value;
  await db.query("select public.begin_account_deletion($1)", [user]);
  await assert.rejects(
    db.query("select public.billing_claim($1,$2)", [user, scope]),
    /ACCOUNT_DELETED/
  );
  await assert.rejects(
    db.query("select public.billing_claim_deletion($1,$2)", [user, scope]),
    /BILLING_BUSY/
  );
  await assert.rejects(
    db.query("select public.prepare_account_deletion($1)", [user]),
    /BILLING_CANCELLATION_REQUIRED/
  );
  await db.query("select public.billing_release($1,$2)", [
    account.id,
    account.lease_token
  ]);
  await assert.rejects(
    db.query(
      "select public.billing_claim_deletion($1,'live:acct_other:price_other')",
      [user]
    ),
    /BILLING_REVIEW_REQUIRED/
  );
  const claimed = (
    await db.query("select public.billing_claim_deletion($1,$2) value", [
      user,
      scope
    ])
  ).rows[0].value;
  await assert.rejects(
    db.query("select public.billing_confirm_deletion($1,gen_random_uuid())", [
      claimed.id
    ]),
    /BILLING_LEASE_LOST/
  );
  await db.exec("set role authenticated");
  await assert.rejects(
    db.query("select public.billing_confirm_deletion($1,$2)", [
      claimed.id,
      claimed.lease_token
    ]),
    /permission denied/
  );
  await assert.rejects(
    db.query("select public.prepare_account_deletion_without_billing($1)", [
      user
    ]),
    /permission denied/
  );
  await db.exec("reset role");
  await db.query("select public.billing_confirm_deletion($1,$2)", [
    claimed.id,
    claimed.lease_token
  ]);
  await assert.rejects(
    db.query("select public.prepare_account_deletion($1)", [user]),
    /BILLING_CANCELLATION_REQUIRED/
  );
  await db.query("select public.billing_release($1,$2)", [
    claimed.id,
    claimed.lease_token
  ]);
  await db.query("select public.prepare_account_deletion($1)", [user]);
});
test("empty billing status rows do not block Basic deletion, but expired uncertain intents still do", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  for (const [index, kind] of ["empty", "customer", "checkout"].entries()) {
    const id = `7e000000-0000-4000-8000-00000000000${index + 2}`;
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
      [id, JSON.stringify({ pseudo: `EmptyBilling${index}` })]
    );
    const account = (
      await db.query(
        "select public.billing_claim($1,'test:acct_fixture:price_fixture') value",
        [id]
      )
    ).rows[0].value;
    if (kind !== "empty")
      await db.query(
        `update public.billing_accounts set ${kind === "customer" ? "customer_started_at" : "checkout_started_at"}=clock_timestamp() where id=$1`,
        [account.id]
      );
    await db.query("select public.begin_account_deletion($1)", [id]);
    await assert.rejects(
      db.query("select public.prepare_account_deletion($1)", [id]),
      /BILLING_CANCELLATION_REQUIRED/
    );
    await db.query(
      "update public.billing_accounts set lease_until=clock_timestamp()-interval '1 second' where id=$1",
      [account.id]
    );
    if (kind === "empty")
      await db.query("select public.prepare_account_deletion($1)", [id]);
    else
      await assert.rejects(
        db.query("select public.prepare_account_deletion($1)", [id]),
        /BILLING_CANCELLATION_REQUIRED/
      );
  }
});
