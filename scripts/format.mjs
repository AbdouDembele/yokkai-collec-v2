import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Only tracked files: never rewrite unknown local work or generated files.
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const cli = fileURLToPath(
  new URL("../node_modules/prettier/bin/prettier.cjs", import.meta.url)
);
// Windows has a command-line length limit. Keep the same tracked-file scope
// and formatting options, but invoke Prettier in bounded batches on every OS.
const options = [cli, "--ignore-unknown", ...process.argv.slice(2)];
let batch = [],
  length = options.join(" ").length;
function formatBatch() {
  if (!batch.length) return;
  const result = spawnSync(process.execPath, [...options, ...batch], {
    stdio: "inherit",
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  batch = [];
  length = options.join(" ").length;
}
for (const file of files) {
  if (length + file.length + 3 > 20000) formatBatch();
  batch.push(file);
  length += file.length + 3;
}
formatBatch();
