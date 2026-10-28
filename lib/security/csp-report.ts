// Browser reports are untrusted telemetry. Keep only coarse origins and known
// directives; paths, query strings, samples and authentication data are dropped.
const directives = new Set([
  "default-src",
  "script-src",
  "script-src-elem",
  "script-src-attr",
  "style-src",
  "style-src-elem",
  "style-src-attr",
  "connect-src",
  "img-src",
  "font-src",
  "media-src",
  "frame-src",
  "frame-ancestors",
  "worker-src",
  "object-src",
  "base-uri",
  "form-action",
  "manifest-src"
]);

function origin(value: unknown) {
  if (typeof value !== "string" || value.length > 4096) return null;
  if (["inline", "eval", "data", "blob"].includes(value)) return value;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      url.origin.length <= 256
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

export function sanitizeCspReports(input: unknown) {
  const reports = Array.isArray(input) ? input.slice(0, 10) : [input];
  return reports.flatMap(report => {
    if (!report || typeof report !== "object") return [];
    const item = report as Record<string, unknown>;
    if (Array.isArray(input) && item.type !== "csp-violation") return [];
    const body = item["csp-report"] ?? item.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) return [];
    const fields = body as Record<string, unknown>;
    const directive =
      fields["effective-directive"] ?? fields.effectiveDirective;
    if (typeof directive !== "string" || !directives.has(directive)) return [];
    return [
      {
        event: "security.csp_violation",
        directive,
        disposition: fields.disposition === "enforce" ? "enforce" : "report",
        documentOrigin: origin(fields["document-uri"] ?? fields.documentURL),
        blockedOrigin: origin(fields["blocked-uri"] ?? fields.blockedURL)
      }
    ];
  });
}

// Worker-wide ceiling, independent of spoofable client IP headers. It bounds
// parsing and logging even under a flood. This is not a distributed WAF quota.
export function createCspReportHandler({
  now = Date.now,
  log = (value: string) => console.warn(value),
  siteOrigin
}: {
  now?: () => number;
  log?: (value: string) => void;
  siteOrigin?: string;
} = {}) {
  let windowStarted = -Infinity,
    count = 0;
  // Aggregated logging: the first report of each kind in a 60 s window is
  // logged at once; identical ones only add to a repeats line at window end.
  const seen = new Map<string, { report: object; repeats: number }>();
  let aggregateStarted = -Infinity,
    overflow = 0,
    flushTimer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(flushTimer);
    flushTimer = undefined;
    for (const { report, repeats } of seen.values())
      if (repeats)
        log(
          JSON.stringify({
            ...report,
            event: "security.csp_violation_repeats",
            repeats,
            windowSeconds: 60
          })
        );
    if (overflow)
      log(
        JSON.stringify({
          event: "security.csp_violation_overflow",
          reports: overflow,
          windowSeconds: 60
        })
      );
    seen.clear();
    overflow = 0;
  };
  const record = (report: object) => {
    if (now() - aggregateStarted >= 60000) {
      flush();
      aggregateStarted = now();
    }
    const key = JSON.stringify(report);
    const entry = seen.get(key);
    if (entry) {
      entry.repeats++;
      return;
    }
    // Bound memory under a flood of distinct reports.
    if (seen.size >= 100) {
      overflow++;
      return;
    }
    seen.set(key, { report, repeats: 0 });
    log(key);
    if (!flushTimer) {
      flushTimer = setTimeout(flush, 60000);
      // Never keep the worker alive just to print a summary.
      (flushTimer as { unref?: () => void }).unref?.();
    }
  };
  return async function POST(request: Request) {
    const headers = {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    };
    const reply = (status: number) => new Response(null, { status, headers });
    if (request.headers.get("sec-fetch-site") === "cross-site")
      return reply(403);
    const source = request.headers.get("origin");
    // Behind the reverse proxy, request.url may contain the internal hostname.
    // Use the configured public URL, never a client-supplied forwarding header.
    const expectedOrigin = new URL(siteOrigin || request.url).origin;
    if (source && source !== expectedOrigin) return reply(403);
    const type = request.headers.get("content-type")?.split(";")[0].trim();
    if (
      !["application/csp-report", "application/reports+json"].includes(
        type ?? ""
      )
    )
      return reply(415);
    if (now() - windowStarted >= 60000) {
      windowStarted = now();
      count = 0;
    }
    if (++count > 60)
      return new Response(null, {
        status: 429,
        headers: { ...headers, "Retry-After": "60" }
      });
    if (Number(request.headers.get("content-length")) > 16384)
      return reply(413);
    const reader = request.body?.getReader();
    if (!reader) return reply(400);
    // A disconnected or faulty stream can reject cancellation itself. Never
    // leave that rejection unhandled in this unauthenticated endpoint.
    const cancel = () => {
      void reader.cancel().catch(() => {});
    };
    const chunks: Uint8Array[] = [];
    let size = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          cancel();
          reject(new Error("timeout"));
        }, 2000);
      });
      while (true) {
        const { done, value } = await Promise.race([reader.read(), timeout]);
        if (done) break;
        size += value.byteLength;
        if (size > 16384) {
          cancel();
          return reply(413);
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const reports = sanitizeCspReports(
        JSON.parse(new TextDecoder().decode(bytes))
      );
      if (!reports.length) return reply(400);
      for (const report of reports) record(report);
      return reply(204);
    } catch {
      return reply(400);
    } finally {
      clearTimeout(timer);
    }
  };
}
