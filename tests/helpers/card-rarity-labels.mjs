import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Load the real presentation module in tests that transpile components in a VM.
const context = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(
    readFileSync(
      new URL("../../lib/ui/card-rarity-label.ts", import.meta.url),
      "utf8"
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }
  ).outputText,
  context
);
export const cardRarityLabels = context.exports;
