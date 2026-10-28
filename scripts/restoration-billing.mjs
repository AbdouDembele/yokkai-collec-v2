// Manual administrative entry point only: load the exact server billing adapter.
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { readFileSync } from "node:fs";

export async function loadRestorationBilling() {
  const urls = new Set(
    ["deletion", "config", "store"].map(
      name => new URL(`../lib/billing/${name}.ts`, import.meta.url).href
    )
  );
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (urls.has(context.parentURL)) {
        // These modules are only loaded by the confirmed administrative CLI.
        if (specifier === "server-only")
          return { url: "data:text/javascript,export{}", shortCircuit: true };
        if (["./config", "./store"].includes(specifier))
          return nextResolve(`${specifier}.ts`, context);
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      if (urls.has(url))
        return {
          format: "module",
          source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8"), {
            mode: "transform"
          }),
          shortCircuit: true
        };
      return nextLoad(url, context);
    }
  });
  try {
    return (await import("../lib/billing/deletion.ts"))
      .cancelDeletedAccountBilling;
  } finally {
    hooks.deregister();
  }
}
