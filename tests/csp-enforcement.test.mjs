import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
function loadConfig(enforce, mode = "production") {
  const compiled = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync("next.config.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true }
    }).outputText,
    {
      module: compiled,
      exports: compiled.exports,
      URL,
      require,
      process: {
        env: {
          NODE_ENV: mode,
          NEXT_PUBLIC_SUPABASE_URL: "https://database.test",
          NEXT_PUBLIC_SITE_URL: "https://yokkai-collec.test",
          CSP_ENFORCE: enforce
        }
      }
    }
  );
  return compiled.exports.default;
}
function loadReports() {
  const compiled = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync("lib/security/csp-report.ts", "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }).outputText,
    {
      module: compiled,
      exports: compiled.exports,
      URL,
      Response,
      TextDecoder,
      Uint8Array,
      setTimeout,
      clearTimeout,
      console
    }
  );
  return compiled.exports;
}
const report = {
  "csp-report": {
    "document-uri":
      "https://yokkai-collec.com/profile/private-user?token=secret#private",
    "blocked-uri": "https://assets.test/user/private?key=secret",
    "effective-directive": "script-src-attr",
    disposition: "enforce",
    "script-sample": "secret user data"
  }
};
const post = (body = JSON.stringify(report), headers = {}) =>
  new Request("https://yokkai-collec.com/api/security/csp-report", {
    method: "POST",
    headers: { "content-type": "application/csp-report", ...headers },
    body
  });
test("enforced rollout blocks external scripts, inline handlers, objects and framing while allowing actual application sources", async () => {
  const h = (await loadConfig("true").headers())[0].headers;
  const csp = h.find(x => x.key === "Content-Security-Policy").value;
  assert.match(
    csp,
    /script-src 'self' 'unsafe-inline' https:\/\/static.cloudflareinsights.com https:\/\/challenges.cloudflare.com/
  );
  for (const d of [
    "script-src-attr 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "frame-src https://challenges.cloudflare.com",
    "report-uri /api/security/csp-report"
  ])
    assert(csp.includes(d));
  assert.match(
    csp,
    /connect-src 'self' https:\/\/database.test wss:\/\/database.test/
  );
  assert(!csp.includes("unsafe-eval"));
  assert(!csp.includes("googleapis.com"));
  assert(!csp.includes("gstatic.com"));
  assert(csp.includes("font-src 'self'"));
  assert(h.some(x => x.key === "Content-Security-Policy-Report-Only"));
  const dev = (
    await loadConfig("true", "development").headers()
  )[0].headers.find(x => x.key === "Content-Security-Policy").value;
  assert(dev.includes("'unsafe-eval'"));
});
test("collector preserves useful directives but drops account paths, query strings, credentials and script samples", async () => {
  const logs = [];
  const { createCspReportHandler } = loadReports();
  const handler = createCspReportHandler({ log: s => logs.push(s) });
  const response = await handler(post());
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(logs.length, 1);
  const event = JSON.parse(logs[0]);
  assert.equal(event.documentOrigin, "https://yokkai-collec.com");
  assert.equal(event.blockedOrigin, "https://assets.test");
  assert.equal(event.disposition, "enforce");
  assert.equal(event.directive, "script-src-attr");
  assert.doesNotMatch(logs[0], /private|secret|token|sample/);
  const modern = await handler(
    post(
      JSON.stringify([
        {
          type: "csp-violation",
          body: {
            effectiveDirective: "img-src",
            documentURL: "https://yokkai-collec.com/social?user=private",
            blockedURL: "inline"
          }
        }
      ]),
      { "content-type": "application/reports+json" }
    )
  );
  assert.equal(modern.status, 204);
  assert.equal(JSON.parse(logs[1]).directive, "img-src");
});
test("collector bounds requests, streamed bodies and batch sizes, rejects cross-site/non-report traffic, and resets quota", async () => {
  let now = 100000;
  const logs = [];
  const { createCspReportHandler } = loadReports();
  const handler = createCspReportHandler({
    now: () => now,
    log: s => logs.push(s)
  });
  assert.equal(
    (await handler(post("{}", { origin: "https://evil.test" }))).status,
    403
  );
  assert.equal(
    (await handler(post("{}", { "sec-fetch-site": "cross-site" }))).status,
    403
  );
  assert.equal(
    (await handler(post("{}", { "content-type": "application/json" }))).status,
    415
  );
  assert.equal((await handler(post("x".repeat(16385)))).status, 413);
  assert.equal((await handler(post("invalid"))).status, 400);
  assert.equal(
    (
      await handler(
        post(
          JSON.stringify({
            "csp-report": { "effective-directive": "attacker\nlogline" }
          })
        )
      )
    ).status,
    400
  );
  for (let i = 0; i < 57; i++)
    assert.equal((await handler(post())).status, 204);
  const blocked = await handler(post());
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("retry-after"), "60");
  now += 60000;
  assert.equal((await handler(post())).status, 204);
  // Distinct reports: identical ones are aggregated into a single line.
  const batch = Array.from({ length: 50 }, (_, i) => ({
    type: "csp-violation",
    body: {
      effectiveDirective: "connect-src",
      blockedURL: `https://a${i}.test/`
    }
  }));
  const before = logs.length;
  assert.equal(
    (
      await handler(
        post(JSON.stringify(batch), {
          "content-type": "application/reports+json"
        })
      )
    ).status,
    204
  );
  assert.equal(logs.length - before, 10);
});

test("stream cancellation failures remain contained for oversized and stalled requests", async () => {
  const { createCspReportHandler } = loadReports();
  for (const oversized of [true, false]) {
    let cancellations = 0;
    const stream = new ReadableStream({
      start(controller) {
        if (oversized) controller.enqueue(new Uint8Array(16385));
      },
      cancel() {
        cancellations++;
        throw new Error("Untrusted underlying stream failure");
      }
    });
    const request = new Request(
      "https://yokkai-collec.com/api/security/csp-report",
      {
        method: "POST",
        headers: { "content-type": "application/csp-report" },
        body: stream,
        duplex: "half"
      }
    );
    const handler = createCspReportHandler({
      log: () => assert.fail("invalid report logged")
    });
    const response = await handler(request);
    assert.equal(response.status, oversized ? 413 : 400);
    assert.equal(cancellations, 1);
    // Give rejected cancellation promises a turn to surface; node:test fails on
    // an unhandled rejection even after the HTTP response has already returned.
    await new Promise(resolve => setImmediate(resolve));
  }
});

test("configured public origin accepts same-site reports behind the proxy and rejects forged forwarding origins", async () => {
  const logs = [];
  const { createCspReportHandler } = loadReports();
  const handler = createCspReportHandler({
    siteOrigin: "https://yokkai-collec.com",
    log: value => logs.push(value)
  });
  const request = (origin, extra = {}) =>
    new Request("http://internal-container:3000/api/security/csp-report", {
      method: "POST",
      headers: { "content-type": "application/csp-report", origin, ...extra },
      body: JSON.stringify(report)
    });
  assert.equal(
    (await handler(request("https://yokkai-collec.com"))).status,
    204
  );
  assert.equal(logs.length, 1);
  assert.equal(
    (
      await handler(
        request("https://evil.test", {
          "x-forwarded-host": "evil.test",
          "x-forwarded-proto": "https",
          forwarded: "host=evil.test;proto=https"
        })
      )
    ).status,
    403
  );
  assert.equal(
    (await handler(request("http://internal-container:3000"))).status,
    403
  );
  assert.equal(
    (
      await handler(
        request("https://yokkai-collec.com", { "sec-fetch-site": "cross-site" })
      )
    ).status,
    403
  );
  assert.equal(logs.length, 1);
});

test("identical reports are logged once per window, then as one repeats line", async () => {
  let now = 500000;
  const logs = [];
  const { createCspReportHandler } = loadReports();
  const handler = createCspReportHandler({
    now: () => now,
    log: value => logs.push(JSON.parse(value))
  });
  for (let i = 0; i < 25; i++)
    assert.equal((await handler(post())).status, 204);
  const other = JSON.stringify({
    "csp-report": {
      "document-uri": "https://yokkai-collec.com/",
      "blocked-uri": "https://fonts.example/",
      "effective-directive": "font-src"
    }
  });
  await handler(post(other));
  assert.deepEqual(
    logs.map(entry => [entry.event, entry.directive]),
    [
      ["security.csp_violation", "script-src-attr"],
      ["security.csp_violation", "font-src"]
    ],
    "one line per distinct report, not per request"
  );
  now += 60000;
  await handler(post(other));
  const repeats = logs.filter(
    entry => entry.event === "security.csp_violation_repeats"
  );
  assert.deepEqual(
    repeats.map(entry => [entry.directive, entry.repeats, entry.windowSeconds]),
    [["script-src-attr", 24, 60]]
  );
  assert.equal(repeats[0].blockedOrigin, "https://assets.test");
  assert.equal(logs.at(-1).directive, "font-src", "a new window logs again");
  for (const entry of logs)
    assert.deepEqual(
      Object.keys(entry).filter(
        key =>
          ![
            "event",
            "directive",
            "disposition",
            "documentOrigin",
            "blockedOrigin",
            "repeats",
            "windowSeconds"
          ].includes(key)
      ),
      [],
      "nothing beyond the directive, disposition and coarse origins"
    );
  // A flood of distinct reports is bounded in memory and summarized.
  now += 60000;
  for (let i = 0; i < 6; i++)
    await handler(
      post(
        JSON.stringify(
          Array.from({ length: 10 }, (_, j) => ({
            type: "csp-violation",
            body: {
              effectiveDirective: "img-src",
              blockedURL: `https://flood${i * 10 + j}.test/`
            }
          }))
        ),
        { "content-type": "application/reports+json" }
      )
    );
  for (let i = 0; i < 5; i++)
    await handler(
      post(
        JSON.stringify(
          Array.from({ length: 10 }, (_, j) => ({
            type: "csp-violation",
            body: {
              effectiveDirective: "img-src",
              blockedURL: `https://more${i * 10 + j}.test/`
            }
          }))
        ),
        { "content-type": "application/reports+json" }
      )
    );
  now += 60000;
  await handler(post(other));
  assert.deepEqual(
    logs.filter(entry => entry.event === "security.csp_violation_overflow"),
    [
      {
        event: "security.csp_violation_overflow",
        reports: 10,
        windowSeconds: 60
      }
    ]
  );
});

test("reports use both report-uri and the Reporting API endpoint", async () => {
  const h = (await loadConfig("false").headers())[0].headers;
  const reportOnly = h.find(
    x => x.key === "Content-Security-Policy-Report-Only"
  ).value;
  assert.ok(!h.some(x => x.key === "Content-Security-Policy"), "not enforced");
  assert.match(reportOnly, /report-uri \/api\/security\/csp-report/);
  assert.match(reportOnly, /report-to csp-endpoint/);
  assert.equal(
    h.find(x => x.key === "Reporting-Endpoints").value,
    'csp-endpoint="https://yokkai-collec.test/api/security/csp-report"'
  );
});
