import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
const require = createRequire(import.meta.url);
export function loadDisposableEmail(
  snapshot = JSON.parse(
    readFileSync("data/disposable-email-domains.json", "utf8")
  )
) {
  const exports = {};
  const source = ts.transpileModule(
    readFileSync("lib/server/disposable-email.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }
  ).outputText;
  vm.runInNewContext(source, {
    exports,
    require: name => {
      if (name === "server-only") return {};
      if (name === "node:url") return require(name);
      if (name === "@/data/disposable-email-domains.json")
        return { default: snapshot, __esModule: true };
      throw new Error("Unexpected domain-policy dependency: " + name);
    }
  });
  return exports;
}
