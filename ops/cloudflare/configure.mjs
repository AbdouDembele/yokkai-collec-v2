// Run on the origin only. Secret-bearing output stays in this private directory.
import { readFile, writeFile } from "node:fs/promises";
import { renderFirewall, renderMiddleware } from "./render.mjs";
const dir = process.env.EDGE_CONFIG_DIR;
if (!dir) throw new Error("EDGE_CONFIG_DIR required");
const ranges = JSON.parse(await readFile(`${dir}/ranges.json`, "utf8"));
const proof = (await readFile(`${dir}/secrets/proxy-proof`, "utf8")).trim();
await writeFile(
  `${dir}/middleware.json`,
  JSON.stringify(renderMiddleware(ranges["4"], ranges["6"], proof), null, 2),
  { mode: 0o600 }
);
await writeFile(
  `${dir}/firewall.nft`,
  renderFirewall(
    ranges["4"],
    ranges["6"],
    process.env.EDGE_INTERFACE || "eth0",
    Number(process.env.EDGE_SSH_PORT || 1022)
  ),
  { mode: 0o600 }
);
