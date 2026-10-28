import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(
  new URL("../scripts/format.mjs", import.meta.url),
  "utf8"
).replaceAll("import.meta.url", "'file:///workspace/scripts/format.mjs'");
function run(files, failure) {
  const calls = [];
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
  vm.runInNewContext(compiled, {
    exports: {},
    URL,
    process: {
      execPath: "node",
      argv: ["node", "format.mjs", "--write"],
      exit: status => {
        throw Error("EXIT_" + status);
      }
    },
    require: id =>
      id === "node:url"
        ? { fileURLToPath: () => "prettier.cjs" }
        : {
            execFileSync: (command, args) => {
              assert.equal(command, "git");
              assert.equal(args[0], "ls-files");
              return files.join("\0") + "\0";
            },
            spawnSync: (command, args, options) => {
              calls.push(args);
              assert.equal(command, "node");
              assert.equal(options.windowsHide, true);
              return failure || { status: 0 };
            }
          }
  });
  return calls;
}
test("format batches stay bounded and visit every tracked path exactly once", () => {
  const files = Array.from(
    { length: 800 },
    (_, i) => `components/${"long-folder/".repeat(8)}${i}.tsx`
  );
  const calls = run(files);
  assert.ok(calls.length > 1);
  assert.deepEqual(
    calls.flatMap(args => Array.from(args).slice(3)),
    files
  );
  for (const args of calls) {
    assert.deepEqual(Array.from(args).slice(0, 3), [
      "prettier.cjs",
      "--ignore-unknown",
      "--write"
    ]);
    assert.ok(args.join(" ").length < 20000);
  }
});
test("format failures are never swallowed or followed by a later batch", () => {
  assert.throws(() => run(["a.ts"], { status: 2 }), /EXIT_2/);
  assert.throws(
    () => run(["a.ts"], { error: Error("SPAWN_FAILED") }),
    /SPAWN_FAILED/
  );
});
