import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }).outputText,
    {
      exports,
      require: name => {
        if (name in imports) return imports[name];
        throw Error(name);
      }
    }
  );
  return exports;
}
const release = load("lib/ui/product-updates.ts");
test("Update receipts are scoped by account and release and survive unavailable storage", () => {
  const values = new Map(),
    storage = {
      getItem: k => values.get(k) ?? null,
      setItem: (k, v) => values.set(k, v)
    };
  assert.equal(release.hasProductUpdateReceipt(storage, "alice"), false);
  release.rememberProductUpdate(storage, "alice");
  assert.equal(release.hasProductUpdateReceipt(storage, "alice"), true);
  assert.equal(release.hasProductUpdateReceipt(storage, "bob"), false);
  assert(release.productUpdateKey("alice").includes(release.PRODUCT_UPDATE_ID));
  const blocked = {
    getItem() {
      throw Error("storage blocked");
    },
    setItem() {
      throw Error("storage blocked");
    }
  };
  assert.equal(release.hasProductUpdateReceipt(blocked, "alice"), false);
  assert.doesNotThrow(() => release.rememberProductUpdate(blocked, "alice"));
  assert.equal(release.hasProductUpdateReceipt(null, "alice"), false);
});
test("Acknowledgement writes only the session account's cosmetic metadata and only once", async () => {
  const writes = [];
  let user = {
    id: "session-player",
    user_metadata: { pseudo: "ExistingName" }
  };
  const action = load("app/product-updates/actions.ts", {
    "next/headers": { cookies: async () => ({}) },
    "@/lib/ui/product-updates": release,
    "@/utils/supabase/server": {
      createClient: () => ({
        auth: {
          getUser: async () => ({ data: { user }, error: null }),
          updateUser: async input => {
            writes.push(input);
            return { error: null };
          }
        }
      })
    }
  });
  assert.equal(
    (await action.acknowledgeProductUpdate("other-player")).ok,
    true
  );
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0]), ["data"]);
  assert.deepEqual(Object.keys(writes[0].data), [
    release.PRODUCT_UPDATE_METADATA_KEY
  ]);
  assert.equal(
    writes[0].data[release.PRODUCT_UPDATE_METADATA_KEY],
    release.PRODUCT_UPDATE_ID
  );
  user.user_metadata[release.PRODUCT_UPDATE_METADATA_KEY] =
    release.PRODUCT_UPDATE_ID;
  assert.equal((await action.acknowledgeProductUpdate()).ok, true);
  assert.equal(writes.length, 1);
  user = null;
  assert.equal((await action.acknowledgeProductUpdate()).ok, false);
  assert.equal(writes.length, 1);
});
test("An unavailable account service does not break navigation", async () => {
  const action = load("app/product-updates/actions.ts", {
    "next/headers": { cookies: async () => ({}) },
    "@/lib/ui/product-updates": release,
    "@/utils/supabase/server": {
      createClient: () => {
        throw Error("offline");
      }
    }
  });
  assert.equal((await action.acknowledgeProductUpdate()).ok, false);
});
