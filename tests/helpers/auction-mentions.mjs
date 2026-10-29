import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
const target = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(
    readFileSync(
      new URL("../../lib/ui/auction-mentions.ts", import.meta.url),
      "utf8"
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }
  ).outputText,
  { exports: target.exports, module: target }
);
export const { auctionMentionParts } = target.exports;
