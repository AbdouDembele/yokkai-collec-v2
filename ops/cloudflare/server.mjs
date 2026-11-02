import { createServer } from "node:http";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { canonicalIp, equalSecret, ipIdentity } from "./identity.mjs";

const secretDir = process.env.EDGE_SECRET_DIR || "/run/secrets";
const dataDir = process.env.EDGE_DATA_DIR || "/data";
const proof = (await readFile(`${secretDir}/proxy-proof`, "utf8")).trim();
const key = (await readFile(`${secretDir}/ip-hmac`, "utf8")).trim();
const version = (await readFile(`${secretDir}/key-version`, "utf8")).trim();
if (!equalSecret(proof, proof))
  throw new Error("Invalid edge proof configuration");
ipIdentity("192.0.2.1", key, version);
await mkdir(dataDir, { recursive: true, mode: 0o700 });
const file = `${dataDir}/ip-observations.json`;
const retentionMs = 7 * 86400_000;
const capacity = 100_000;
const observations = new Map();
try {
  for (const row of JSON.parse(await readFile(file, "utf8"))) {
    if (observations.size >= capacity) break;
    if (
      /^v[1-9][0-9]*:[a-f0-9]{64}$/.test(row.id) &&
      Number.isSafeInteger(row.firstSeen) &&
      Number.isSafeInteger(row.lastSeen) &&
      Number.isSafeInteger(row.count) &&
      row.count > 0 &&
      row.lastSeen > Date.now() - retentionMs
    )
      observations.set(row.id, {
        id: row.id,
        firstSeen: row.firstSeen,
        lastSeen: row.lastSeen,
        count: row.count
      });
  }
} catch (error) {
  if (error.code !== "ENOENT")
    throw new Error("Invalid edge observations store");
}
let saving = false;
async function save() {
  if (saving) return;
  saving = true;
  try {
    const cutoff = Date.now() - retentionMs;
    for (const [id, row] of observations)
      if (row.lastSeen <= cutoff) observations.delete(id);
    await writeFile(`${file}.tmp`, JSON.stringify([...observations.values()]), {
      mode: 0o600
    });
    await rename(`${file}.tmp`, file);
  } finally {
    saving = false;
  }
}
const timer = setInterval(() => {
  save().catch(() => console.error("Edge observation persistence failed"));
}, 30_000);
const server = createServer({ maxHeaderSize: 8192 }, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(204).end();
    return;
  }
  if (
    req.url !== "/verify" ||
    !equalSecret(req.headers["x-yokkai-edge-proof"], proof)
  ) {
    res.writeHead(403).end();
    return;
  }
  // Duplicate values must be rejected, even if Node coalesces them.
  const names = req.rawHeaders
    .filter((_, i) => i % 2 === 0)
    .map(x => x.toLowerCase());
  const ip = canonicalIp(req.headers["cf-connecting-ip"]);
  if (
    !ip ||
    names.filter(x => x === "cf-connecting-ip").length !== 1 ||
    names.filter(x => x === "x-yokkai-edge-proof").length !== 1
  ) {
    res.writeHead(403).end();
    return;
  }
  const id = ipIdentity(ip, key, version);
  const now = Date.now();
  const existing = observations.get(id);
  if (existing) {
    existing.lastSeen = now;
    existing.count = Math.min(existing.count + 1, Number.MAX_SAFE_INTEGER);
  } else if (observations.size < capacity)
    observations.set(id, { id, firstSeen: now, lastSeen: now, count: 1 });
  // Raw IP exists only in transit. Never log request headers, URL or IP.
  res.setHeader("X-Yokkai-Client-IP", ip);
  res.setHeader("X-Yokkai-IP-HMAC", id);
  res.setHeader("CF-Connecting-IP", ip);
  res.setHeader("X-Real-IP", ip);
  res.setHeader("X-Forwarded-For", ip);
  res.writeHead(204).end();
});
server.headersTimeout = 5000;
server.requestTimeout = 5000;
server.keepAliveTimeout = 5000;
server.maxConnections = 256;
server.listen(Number(process.env.PORT || 9080), "0.0.0.0", () => {
  process.send?.({ port: server.address().port });
});
function shutdown() {
  clearInterval(timer);
  server.close(async () => {
    await save();
    process.exit(0);
  });
}
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, shutdown);
// IPC is only available to the local test harness, never over HTTP.
if (process.send)
  process.on("message", message => {
    if (message?.shutdown) shutdown();
  });
