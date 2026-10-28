import { englishMessages } from "./helpers/i18n.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadClient(responses) {
  const code = ts.transpileModule(
    readFileSync(
      new URL("../utils/supabase/client.ts", import.meta.url),
      "utf8"
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }
  ).outputText;
  const state = { signOuts: [], redirects: [], options: undefined };
  const client = {
    auth: {
      signOut: async options => {
        state.signOuts.push(options);
      }
    }
  };
  const context = {
    exports: {},
    Response,
    fetch: async () => responses.shift(),
    window: { location: { replace: path => state.redirects.push(path) } },
    require(name) {
      if (name === "@supabase/ssr")
        return {
          createBrowserClient: (url, key, options) => {
            state.options = options;
            return client;
          }
        };
      if (name === "@/utils/supabase/config")
        return {
          getSupabaseConfig: () => ({ url: "u", key: "k", cookieName: "c" })
        };
      throw new Error(`Unexpected import: ${name}`);
    }
  };
  vm.runInNewContext(code, context);
  context.exports.createClient();
  return { state, fetch: state.options.global.fetch };
}

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });

test("ACCOUNT_BANNED signs the player out once and explains why", async () => {
  const { state, fetch } = loadClient([
    json(400, { code: "P0001", message: "PACK_NOT_READY" }),
    json(200, { message: "ACCOUNT_BANNED in data is not an error" }),
    json(400, { code: "P0001", message: "ACCOUNT_BANNED" }),
    json(400, { code: "P0001", message: "ACCOUNT_BANNED" })
  ]);
  for (let i = 0; i < 2; i++) await fetch("https://u/rest/v1/rpc/x");
  assert.deepEqual(state.redirects, []);
  const banned = await fetch("https://u/rest/v1/rpc/open_regular_pack");
  // The caller still receives the original error body.
  assert.equal((await banned.json()).message, "ACCOUNT_BANNED");
  await fetch("https://u/rest/v1/rpc/touch_presence");
  await new Promise(resolve => setImmediate(resolve));
  // Objects come from the vm realm: compare their values.
  assert.deepEqual(
    state.signOuts.map(options => options.scope),
    ["local"]
  );
  assert.deepEqual(state.redirects, ["/login?account=banned"]);
});

test("login page explains the banned redirect in English", () => {
  const page = readFileSync(
    new URL("../app/(auth)/login/page.tsx", import.meta.url),
    "utf8"
  );
  assert.match(page, /account === "banned"/);
  assert.match(page, /t\("yourAccountIsBannedYouHaveBeenSignedOut"\)/);
  assert.equal(
    englishMessages.page.yourAccountIsBannedYouHaveBeenSignedOut,
    "Your account is banned. You have been signed out."
  );
});
