import { after } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/utils/supabase/config";
import { hasRecentAuthentication } from "@/lib/auth/recent-auth";

export const runtime = "nodejs";
export const maxDuration = 60;
const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff"
};

export function GET() {
  return Response.json(
    { error: "Method not allowed." },
    { status: 405, headers: { ...privateHeaders, Allow: "POST" } }
  );
}
export const HEAD = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
export const OPTIONS = GET;

export async function POST(request: Request) {
  const reply = (status: number, body: object, extra = {}) =>
    Response.json(body, { status, headers: { ...privateHeaders, ...extra } });
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (!site) return reply(503, { error: "Download unavailable." });
  if (request.headers.get("origin") !== new URL(site).origin)
    return reply(403, { error: "Request denied." });
  if (request.headers.get("content-type") !== "application/json")
    return reply(400, { error: "Invalid request." });
  let userId: string | undefined;
  let admin: SupabaseClient | undefined;
  let attempted = false;
  let handedOff = false;
  const requestId = randomUUID();
  const deadline = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(30_000)
  ]);
  async function receipt(sent: boolean) {
    if (!attempted || !admin || !userId) return;
    try {
      const result = await admin
        .rpc("finish_data_export", {
          p_user_id: userId,
          p_request_id: requestId,
          p_sent: sent
        })
        .abortSignal(AbortSignal.timeout(5000));
      if (result.error) console.error("DATA_EXPORT_RECEIPT_FAILED");
    } catch {
      console.error("DATA_EXPORT_RECEIPT_FAILED");
    }
  }
  try {
    // Bound the body even when Content-Length is absent or forged. No player ID
    // is accepted; the only valid payload is an empty object.
    const reader = request.body?.getReader();
    if (!reader) return reply(400, { error: "Invalid request." });
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 1024) {
        await reader.cancel();
        return reply(400, { error: "Invalid request." });
      }
      chunks.push(value);
    }
    let input;
    try {
      input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return reply(400, { error: "Invalid request." });
    }
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).length
    )
      return reply(400, { error: "Invalid request." });
    const { url, key, cookieName } = getSupabaseConfig();
    const store = await cookies();
    const client = createServerClient(url, key, {
      cookieOptions: { name: cookieName },
      global: {
        fetch: (input, init) => fetch(input, { ...init, signal: deadline })
      },
      cookies: {
        getAll: () => store.getAll(),
        setAll: updates => {
          updates.forEach(({ name, value, options }) =>
            store.set(name, value, options)
          );
        }
      }
    });
    const claims = await client.auth.getClaims();
    const identity = await client.auth.getUser();
    if (
      claims.error ||
      identity.error ||
      !identity.data.user ||
      claims.data?.claims.sub !== identity.data.user.id ||
      claims.data.claims.role !== "authenticated" ||
      claims.data.claims.is_anonymous === true
    )
      return reply(401, {
        error: "Sign in to download your data.",
        reconnect: true
      });
    if (!hasRecentAuthentication(claims.data.claims))
      return reply(403, {
        error:
          "Sign in again, then return to settings. You must have signed in within the last five minutes.",
        reconnect: true
      });
    userId = identity.data.user.id;
    const secret =
      process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) return reply(503, { error: "Download unavailable." });
    admin = createClient(url, secret, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
    const args = { p_user_id: userId, p_request_id: requestId };
    attempted = true;
    const reserved = await admin
      .rpc("reserve_data_export", args)
      .abortSignal(deadline);
    if (reserved.error) {
      if (reserved.error.message === "EXPORT_RATE_LIMITED") {
        const seconds = Math.ceil(
          Math.min(86400, Math.max(1, Number(reserved.error.details) || 86400))
        );
        return reply(
          429,
          {
            error: "You can download your data once every 24 hours.",
            retryAfter: seconds
          },
          { "Retry-After": String(seconds) }
        );
      }
      if (reserved.error.message === "EXPORT_IN_PROGRESS")
        return reply(409, {
          error: "Your data download is already being prepared."
        });
      throw new Error("EXPORT_UNAVAILABLE");
    }
    const built = await admin
      .rpc("build_data_export", args)
      .abortSignal(deadline);
    if (built.error)
      throw new Error(
        built.error.message === "EXPORT_TOO_LARGE"
          ? "EXPORT_TOO_LARGE"
          : "EXPORT_UNAVAILABLE"
      );
    if (
      !built.data ||
      built.data.schema_version !== 1 ||
      built.data.account?.id !== userId
    )
      throw new Error("EXPORT_UNAVAILABLE");
    const body = JSON.stringify(built.data);
    const bytes = Buffer.byteLength(body, "utf8");
    if (bytes > 25 * 1024 * 1024) throw new Error("EXPORT_TOO_LARGE");
    const sending = await admin
      .rpc("mark_data_export_sending", args)
      .abortSignal(deadline);
    if (sending.error || request.signal.aborted)
      throw new Error("EXPORT_UNAVAILABLE");
    const response = new Response(body, {
      headers: {
        ...privateHeaders,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": String(bytes),
        "Content-Disposition": `attachment; filename="my-data-${new Date().toISOString().slice(0, 10)}.json"`
      }
    });
    // after runs on HTTP completion, including premature close. On Node, Next
    // aborts request.signal only for close before writableFinished. A stream
    // merely handed to the framework never counts as a successful download.
    after(() => receipt(handedOff && !request.signal.aborted));
    handedOff = true;
    return response;
  } catch (error) {
    const oversized =
      error instanceof Error && error.message === "EXPORT_TOO_LARGE";
    return reply(oversized ? 413 : 503, {
      error: oversized
        ? "Your data exceeds the automatic download size limit. Email yokkaicollec@gmail.com with the subject Data export request from your account email address to request a complete export. Do not send your password or sign-in codes. This attempt does not count toward your download limit."
        : "We couldn't prepare your data. Try again; this attempt won't count toward your download limit."
    });
  } finally {
    if (!handedOff) await receipt(false);
  }
}
