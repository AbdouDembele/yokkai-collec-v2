import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (!existsSync("graphify-out/graph.json")) {
  console.error("Graphify: no local graph; hook skipped. Use source searches.");
} else {
  const result = spawnSync("graphify", process.argv.slice(2), {
    stdio: "inherit",
    windowsHide: true
  });
  if (result.error?.code === "ENOENT") {
    console.error(
      "Graphify: executable missing from PATH; hook skipped. Use source searches."
    );
  } else {
    if (result.error) console.error(`Graphify: ${result.error.message}`);
    process.exitCode = result.status ?? 1;
  }
}
