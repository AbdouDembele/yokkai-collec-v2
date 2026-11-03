import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const smurf = "ac660000-0000-4000-8000-000000000001",
  primary = "ac660000-0000-4000-8000-000000000002";
function harness() {
  const calls = [];
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync("app/admin/security/actions.ts", "utf8"),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } }
    ).outputText,
    {
      exports,
      require: name =>
        ({
          "next/headers": { cookies: async () => ({}) },
          "next/cache": {
            revalidatePath: path => calls.push(["revalidate", path])
          },
          "next/navigation": {
            redirect: path => {
              throw Error("REDIRECT:" + path);
            }
          },
          "@/lib/auth/admin": {
            requireAdminAction: async () => calls.push(["admin"])
          },
          "@/utils/supabase/server": {
            createClient: () => ({
              rpc: async (name, args) => {
                calls.push([name, args]);
                return { data: {}, error: null };
              }
            })
          }
        })[name]
    }
  );
  return { calls, action: exports.applySmurfSanctionAction };
}
function form(confirmation) {
  const f = new FormData();
  for (const [k, v] of Object.entries({
    smurf_user_id: smurf,
    primary_user_id: primary,
    confirmation,
    note: "Verified named roles and recovery",
    preview_token: "fixture"
  }))
    f.set(k, v);
  return f;
}
test("stale or reversed role confirmations cannot apply any sanction", async () => {
  for (const confirmation of [smurf, `${primary}:${smurf}`, ""]) {
    const h = harness();
    await assert.rejects(
      h.action(form(confirmation)),
      /SMURF_SANCTION_INVALID/
    );
    assert.deepEqual(h.calls, [["admin"]]);
  }
});
test("explicit pair confirmation preserves the exact RPC roles and the redirect role", async () => {
  const h = harness();
  await assert.rejects(
    h.action(form(`${smurf}:${primary}`)),
    /REDIRECT:.*role=smurf/
  );
  const call = h.calls.find(c => c[0] === "admin_apply_sanction");
  assert.equal(call[1].p_subject_user_id, smurf);
  assert.equal(call[1].p_primary_user_id, primary);
  assert.equal(call[1].p_confirmation, smurf);
  assert.equal(call[1].p_preview_token, "fixture");
});
