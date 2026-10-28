import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

test("agent hooks use the portable Graphify wrapper", () => {
  for (const file of [".claude/settings.json", ".codex/hooks.json"]) {
    const config = JSON.parse(readFileSync(file, "utf8"));
    for (const entry of config.hooks.PreToolUse) {
      for (const hook of entry.hooks)
        assert.match(hook.command, /^node scripts\/graphify-hook\.mjs hook-/);
    }
  }
});

test("optional Graphify skips missing prerequisites but preserves real failures", () => {
  const source = ts.transpileModule(
    readFileSync("scripts/graphify-hook.mjs", "utf8"),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS }
    }
  ).outputText;
  function run(exists, result) {
    const calls = [],
      warnings = [];
    const context = {
      exports: {},
      console: { error: text => warnings.push(text) },
      process: { argv: ["node", "hook", "hook-guard", "read"], exitCode: 0 },
      require: name =>
        name === "node:fs"
          ? { existsSync: () => exists }
          : {
              spawnSync: (...args) => {
                calls.push(args);
                return result;
              }
            }
    };
    vm.runInNewContext(source, context);
    return { ...context, calls, warnings };
  }
  let r = run(false, { status: 7 });
  assert.equal(r.calls.length, 0);
  assert.equal(r.process.exitCode, 0);
  assert.equal(r.warnings.length, 1);
  r = run(true, { error: { code: "ENOENT" }, status: null });
  assert.equal(r.process.exitCode, 0);
  assert.equal(r.warnings.length, 1);
  r = run(true, { status: 7 });
  assert.equal(r.process.exitCode, 7);
  assert.equal(r.calls[0][0], "graphify");
  assert.equal(JSON.stringify(r.calls[0][1]), '["hook-guard","read"]');
  assert.equal(r.calls[0][2].stdio, "inherit");
  r = run(true, { error: { code: "EACCES" }, status: null });
  assert.equal(r.process.exitCode, 1);
  assert.equal(run(true, { status: 0 }).process.exitCode, 0);
});
