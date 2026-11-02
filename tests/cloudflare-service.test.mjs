import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { request } from "node:http";
import test from "node:test";

test("edge service rejects forged/missing/duplicate IP and stores only expiring HMAC observations", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "yokkai-edge-"));
  const proof = "a".repeat(64);
  const data = path.join(dir, "data");
  await mkdir(data);
  await writeFile(path.join(dir, "proxy-proof"), proof);
  await writeFile(path.join(dir, "ip-hmac"), "b".repeat(64));
  await writeFile(path.join(dir, "key-version"), "v1");
  await writeFile(
    path.join(data, "ip-observations.json"),
    JSON.stringify([
      { id: `v1:${"c".repeat(64)}`, firstSeen: 1, lastSeen: 1, count: 1 }
    ])
  );
  const child = fork("ops/cloudflare/server.mjs", [], {
    env: {
      ...process.env,
      EDGE_SECRET_DIR: dir,
      EDGE_DATA_DIR: data,
      PORT: "0"
    },
    stdio: ["ignore", "ignore", "pipe", "ipc"]
  });
  let errors = "";
  child.stderr.on("data", chunk => {
    errors += chunk;
  });
  try {
    const [{ port }] = await Promise.race([
      once(child, "message"),
      once(child, "exit").then(() => {
        throw new Error("Edge service exited before ready");
      })
    ]);
    async function call(headers) {
      return new Promise((resolve, reject) => {
        const req = request(
          { host: "127.0.0.1", port, path: "/verify", headers },
          res => {
            res.resume();
            res.on("end", () =>
              resolve({ status: res.statusCode, headers: res.headers })
            );
          }
        );
        req.on("error", reject);
        req.end();
      });
    }
    assert.equal((await call({ "cf-connecting-ip": "192.0.2.1" })).status, 403);
    assert.equal(
      (
        await call({
          "x-yokkai-edge-proof": proof,
          "x-forwarded-for": "192.0.2.1"
        })
      ).status,
      403
    );
    assert.equal(
      (
        await call({
          "x-yokkai-edge-proof": proof,
          "cf-connecting-ip": ["192.0.2.1", "192.0.2.2"]
        })
      ).status,
      403
    );
    const good = await call({
      "x-yokkai-edge-proof": proof,
      "cf-connecting-ip": "::ffff:c000:201",
      "x-yokkai-ip-hmac": "forged"
    });
    assert.equal(good.status, 204);
    assert.equal(good.headers["x-yokkai-client-ip"], "192.0.2.1");
    assert.equal(good.headers["x-forwarded-for"], "192.0.2.1");
    assert.match(good.headers["x-yokkai-ip-hmac"], /^v1:[a-f0-9]{64}$/);
    assert.equal(good.headers["x-yokkai-edge-proof"], undefined);
    const exited = once(child, "exit");
    child.send({ shutdown: true });
    await exited;
    const persisted = await readFile(
      path.join(data, "ip-observations.json"),
      "utf8"
    );
    const rows = JSON.parse(persisted);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, good.headers["x-yokkai-ip-hmac"]);
    assert.deepEqual(Object.keys(rows[0]).sort(), [
      "count",
      "firstSeen",
      "id",
      "lastSeen"
    ]);
    assert.doesNotMatch(persisted + errors, /192\.0\.2\.1|c000:201|forged/);
    assert.equal(rows[0].count, 1);
  } finally {
    if (child.exitCode === null) child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
