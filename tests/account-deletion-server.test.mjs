import * as deletionCore from "../lib/server/account-deletion-core.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const id = "10000000-0000-4000-8000-000000000001";
function harness({
  failure,
  manifest = [{ bucket: "avatars", name: `${id}/avatar.png` }],
  user = { id }
} = {}) {
  const calls = [];
  const admin = {
    rpc: async (name, args) => {
      calls.push([name, args]);
      return {
        error: failure === name ? { message: "PRIVATE_PROVIDER_DETAIL" } : null,
        data: manifest
      };
    },
    storage: {
      from: bucket => ({
        remove: async names => {
          calls.push(["storage", bucket, names]);
          return { error: failure === "storage" ? {} : null };
        }
      })
    },
    auth: {
      admin: {
        deleteUser: async (uuid, soft) => {
          calls.push(["auth", uuid, soft]);
          return {
            error:
              failure === "auth"
                ? { code: "unexpected", message: "PRIVATE_PROVIDER_DETAIL" }
                : failure === "missing"
                  ? { code: "user_not_found" }
                  : null
          };
        }
      }
    }
  };
  const source = readFileSync(
    new URL("../lib/server/account-deletion.ts", import.meta.url),
    "utf8"
  );
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS }
    }).outputText,
    {
      exports,
      process: { env: { SUPABASE_SECRET_KEY: "TEST_ONLY_NOT_A_SECRET" } },
      require: name =>
        ({
          "server-only": {},
          "./account-deletion-core.mjs": deletionCore,
          "@supabase/supabase-js": { createClient: () => admin },
          "@/lib/auth/session": { getCurrentUser: async () => user },
          "@/utils/supabase/config": {
            getSupabaseConfig: () => ({ url: "https://example.test" })
          }
        })[name]
    }
  );
  return { calls, admin, ...exports };
}

test("own account: committed fence, SQL preparation, Storage API then hard Auth Admin deletion", async () => {
  const h = harness();
  await h.deleteCurrentAccount();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [
    ["begin_account_deletion", { p_user_id: id }],
    ["prepare_account_deletion", { p_user_id: id }],
    ["storage", "avatars", [`${id}/avatar.png`]],
    ["auth", id, false]
  ]);
});
test("anonymous and invalid identities cannot start deletion", async () => {
  const h = harness({ user: null });
  await assert.rejects(h.deleteCurrentAccount(), /AUTH_REQUIRED/);
  await assert.rejects(h.deleteAccount("other", h.admin), /INVALID_ACCOUNT/);
  assert.equal(h.calls.length, 0);
});
test("each failing stage stops immediately and does not reveal provider details", async () => {
  for (const [failure, message, count] of [
    ["begin_account_deletion", "START", 1],
    ["prepare_account_deletion", "PREPARATION", 2],
    ["storage", "STORAGE", 3],
    ["auth", "AUTH", 4]
  ]) {
    const h = harness({ failure });
    await assert.rejects(
      h.deleteAccount(id, h.admin),
      e => e.message === `ACCOUNT_DELETION_${message}_FAILED`
    );
    assert.equal(h.calls.length, count);
  }
});
test("foreign paths and unexpected buckets are refused before Storage/Auth deletion", async () => {
  for (const manifest of [
    null,
    [{ bucket: "cards", name: `${id}/x` }],
    [{ bucket: "avatars", name: "another-player/x" }],
    [{ bucket: "avatars", name: `${id}/../another-player/x` }],
    [null]
  ]) {
    const h = harness({ manifest });
    await assert.rejects(
      h.deleteAccount(id, h.admin),
      /STORAGE_MANIFEST_INVALID/
    );
    assert.equal(h.calls.length, 2);
  }
});
test("Storage removal is bounded and Auth already absent is the only tolerated error", async () => {
  const h = harness({
    failure: "missing",
    manifest: Array.from({ length: 201 }, (_, i) => ({
      bucket: "avatars",
      name: `${id}/${i}.png`
    }))
  });
  await h.deleteAccount(id, h.admin);
  assert.deepEqual(
    h.calls.filter(c => c[0] === "storage").map(c => c[2].length),
    [100, 100, 1]
  );
  assert.equal(h.calls.at(-1)[0], "auth");
});

test("account removal deletes private wall files and avatars through their separate Storage buckets", async () => {
  const h = harness({
    manifest: [
      { bucket: "avatars", name: `${id}/avatar.png` },
      { bucket: "profile-wall-media", name: `${id}/post.png` }
    ]
  });
  await h.deleteAccount(id, h.admin);
  assert.deepEqual(
    h.calls.filter(c => c[0] === "storage"),
    [
      ["storage", "avatars", [`${id}/avatar.png`]],
      ["storage", "profile-wall-media", [`${id}/post.png`]]
    ]
  );
  assert.equal(h.calls.at(-1)[0], "auth");
});
