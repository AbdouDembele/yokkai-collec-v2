import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { spawn } from "node:child_process";

const root = new URL("../", import.meta.url);
const local = parseEnv(readFileSync(new URL(".env.local", root), "utf8"));
const api = new URL(local.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid");
if (
  api.protocol !== "http:" ||
  !["localhost", "127.0.0.1"].includes(api.hostname) ||
  api.port !== "54321"
)
  throw Error("Messaging tests require local Supabase on port 54321.");
// Reuse only the public GIPHY web key from the main checkout, never its database credentials.
if (!local.NEXT_PUBLIC_GIPHY_API_KEY) {
  try {
    const main = parseEnv(
      readFileSync(new URL("../../.env.local", root), "utf8")
    );
    if (main.NEXT_PUBLIC_GIPHY_API_KEY)
      local.NEXT_PUBLIC_GIPHY_API_KEY = main.NEXT_PUBLIC_GIPHY_API_KEY;
  } catch {
    /* A standalone checkout can configure its own public key. */
  }
}
const port = process.env.PRIVATE_MESSAGES_PORT ?? "3002";
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535)
  throw Error("Invalid local preview port.");
console.log(
  `Local messaging on port ${port}. GIPHY ${local.NEXT_PUBLIC_GIPHY_API_KEY ? "configured" : "not configured"}.`
);
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--webpack",
    "--port",
    port,
    "--hostname",
    "0.0.0.0"
  ],
  {
    cwd: root,
    env: { ...process.env, ...local },
    stdio: "inherit",
    windowsHide: true
  }
);
child.on("error", error => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", code => {
  process.exitCode = code ?? 1;
});
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
