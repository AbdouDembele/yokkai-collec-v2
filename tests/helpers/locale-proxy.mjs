import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { NextResponse } from "next/server.js";
import { intl, loadLocaleModule } from "./i18n.mjs";
export function loadLocaleProxy(
  updateSession,
  { locale = null, rpcError = null, onRpc = () => {} } = {}
) {
  const context = {
    exports: {},
    Response,
    AbortSignal,
    process: {
      env: { NEXT_PUBLIC_I18N_ENABLED: "true", NODE_ENV: "production" }
    },
    require(name) {
      if (name === "next/server") return { NextResponse };
      if (name === "next-intl") return intl;
      if (name === "@/i18n/locale")
        return loadLocaleModule(context.process.env);
      if (name === "@/utils/supabase/proxy") return { updateSession };
      if (name === "@/utils/supabase/config")
        return {
          getSupabaseConfig: () => ({
            url: "https://example.supabase.co",
            key: "test-key"
          })
        };
      if (name === "@/utils/supabase/auth-fetch")
        return { serverAuthFetch: () => fetch };
      if (name === "@supabase/ssr")
        return {
          createServerClient: () => ({
            auth: {
              getClaims: async () => ({ data: { claims: { sub: "own-user" } } })
            },
            rpc: name => {
              if (name !== "get_my_locale") throw Error(name);
              onRpc();
              return {
                abortSignal: async () => ({ data: locale, error: rpcError })
              };
            }
          })
        };
      if (name.startsWith("@/messages/"))
        return {
          default: JSON.parse(readFileSync(name.replace("@/", ""), "utf8"))
        };
      throw Error(name);
    }
  };
  vm.runInNewContext(
    ts.transpileModule(readFileSync("proxy.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS }
    }).outputText,
    context
  );
  return context.exports.proxy;
}
