import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import * as prettier from "prettier";
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const paths = git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z")
  .split("\0")
  .filter(Boolean);
const changes = [];
for (const file of paths) {
  const info = await prettier.getFileInfo(file, {
    ignorePath: ".prettierignore",
    resolveConfig: false
  });
  if (info.ignored || !info.inferredParser) continue;
  const entry = git("ls-files", "--stage", "--", file).match(
    /^(100644|100755) ([a-f0-9]+) 0\t/
  );
  if (!entry) continue;
  const original = git("show", ":" + file);
  const formatted = await prettier.format(original, {
    ...(await prettier.resolveConfig(file)),
    filepath: file
  });
  if (original !== formatted)
    changes.push({ file, mode: entry[1], original, formatted });
}
// Format every staged blob successfully before touching the index.
for (const { file, mode, original, formatted } of changes) {
  const hash = execFileSync("git", ["hash-object", "-w", "--stdin"], {
    input: formatted,
    encoding: "utf8"
  }).trim();
  git("update-index", "--cacheinfo", mode, hash, file);
  // Preserve partially staged edits, deletions and any unknown local work.
  if (
    existsSync(file) &&
    lstatSync(file).isFile() &&
    readFileSync(file, "utf8").replaceAll("\r\n", "\n") === original
  )
    writeFileSync(file, formatted);
}
if (changes.length)
  console.log(`Prettier: ${changes.length} staged file(s) formatted.`);
