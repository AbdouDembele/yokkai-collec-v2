import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  symlinkSync,
  rmSync,
  realpathSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
const root = process.cwd();
test("pre-commit formats staged content, honors ignores and preserves unstaged work", t => {
  const tempRoot = realpathSync(os.tmpdir());
  const dir = mkdtempSync(path.join(tempRoot, "yokkai-format-hook-"));
  t.after(() => {
    assert.ok(realpathSync(dir).startsWith(tempRoot + path.sep));
    rmSync(dir, { recursive: true, force: true });
  });
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    });
  const write = (file, text) => writeFileSync(path.join(dir, file), text);
  git("init", "-q");
  git("config", "user.name", "Hook test");
  git("config", "user.email", "hook-test@example.invalid");
  git("config", "core.hooksPath", ".githooks");
  git("config", "core.autocrlf", "false");
  git("config", "commit.gpgsign", "false");
  write("partial.js", "const first = 1;\nconst second = 2;\n");
  git("add", "partial.js");
  git("commit", "-qm", "baseline");
  mkdirSync(path.join(dir, "data"));
  write("bad file.js", "const value={answer:42};\n");
  write("data/ignored.json", '{"a":1}');
  write("untracked.js", "const unknown={keep:true};");
  write("partial.js", "const first=10;\nconst second = 2;\n");
  git("add", "bad file.js", "partial.js", "data/ignored.json");
  const unstaged = "const first=10;\nconst second = 20;\n";
  write("partial.js", unstaged);
  copyFileSync(
    path.join(root, ".prettierrc.json"),
    path.join(dir, ".prettierrc.json")
  );
  copyFileSync(
    path.join(root, ".prettierignore"),
    path.join(dir, ".prettierignore")
  );
  if (existsSync(path.join(root, ".githooks/pre-commit"))) {
    mkdirSync(path.join(dir, ".githooks"));
    mkdirSync(path.join(dir, "scripts"));
    copyFileSync(
      path.join(root, ".githooks/pre-commit"),
      path.join(dir, ".githooks/pre-commit")
    );
    copyFileSync(
      path.join(root, "scripts/format-staged.mjs"),
      path.join(dir, "scripts/format-staged.mjs")
    );
    symlinkSync(
      path.join(root, "node_modules"),
      path.join(dir, "node_modules"),
      "junction"
    );
  }
  git("commit", "-qm", "malformed staged sources");
  assert.equal(
    git("show", "HEAD:bad file.js"),
    "const value = { answer: 42 };\n"
  );
  assert.equal(
    git("show", "HEAD:partial.js"),
    "const first = 10;\nconst second = 2;\n"
  );
  assert.equal(readFileSync(path.join(dir, "partial.js"), "utf8"), unstaged);
  assert.equal(
    readFileSync(path.join(dir, "bad file.js"), "utf8"),
    "const value = { answer: 42 };\n"
  );
  assert.equal(git("show", "HEAD:data/ignored.json"), '{"a":1}');
  assert.equal(
    readFileSync(path.join(dir, "untracked.js"), "utf8"),
    "const unknown={keep:true};"
  );
});
