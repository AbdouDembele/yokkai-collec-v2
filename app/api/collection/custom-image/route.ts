import { cookies } from "next/headers";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { getSupabaseConfig } from "@/utils/supabase/config";
import {
  CUSTOM_IMAGE_MAX_BYTES,
  imgurGifVideo
} from "@/lib/ui/custom-image-media";

// Same hosts as set_card_custom_image_for_player: no request ever leaves for
// another host.
const ALLOWED = /^https:\/\/((i\.)?imgur\.com|i\.pinimg\.com)\/\S+$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Stable codes from the SQL function; the interface translates them.
const KNOWN_ERRORS = new Set([
  "AUTH_REQUIRED",
  "ACCOUNT_BANNED",
  "INVALID_IMGUR_URL",
  "CARD_NOT_OWNED",
  "PRO_REQUIRED",
  "ECONOMIC_MAINTENANCE"
]);

async function contentLength(url: string) {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return { ok: false as const };
    const length = Number(response.headers.get("content-length"));
    return {
      ok: true as const,
      bytes: Number.isFinite(length) && length > 0 ? length : null
    };
  } catch {
    return { ok: false as const };
  }
}

// What cards download: the MP4 for Imgur GIFs (when it exists), else the file.
// Unknown sizes are accepted; only a known size over the limit is refused.
async function tooLarge(url: string) {
  const video = imgurGifVideo(url);
  const served = video ? await contentLength(video) : null;
  const size = served?.ok ? served : await contentLength(url);
  return size.ok && size.bytes !== null && size.bytes > CUSTOM_IMAGE_MAX_BYTES;
}

function serviceClient() {
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("CUSTOM_IMAGE_NOT_CONFIGURED");
  return createServiceClient(getSupabaseConfig().url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

// Custom card art is saved here only: players cannot call the SQL function,
// so the weight check (cards download this art in every grid) always runs.
export async function POST(request: Request) {
  const reply = (status: number, body?: object) =>
    Response.json(body ?? {}, {
      status,
      headers: { "Cache-Control": "private, no-store" }
    });
  const session = createClient(await cookies());
  const { data, error } = await session.auth.getClaims();
  const player = data?.claims?.sub;
  if (error || typeof player !== "string" || !player)
    return reply(401, { error: "AUTH_REQUIRED" });
  let body: { instanceId?: unknown; url?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return reply(400);
  }
  const { instanceId, url } = body ?? {};
  if (typeof instanceId !== "string" || !UUID.test(instanceId))
    return reply(400, { error: "CARD_NOT_OWNED" });
  const image = typeof url === "string" ? url.trim() : "";
  if (url !== null && url !== undefined && typeof url !== "string")
    return reply(400, { error: "INVALID_IMGUR_URL" });
  if (image && (image.length > 2048 || !ALLOWED.test(image)))
    return reply(400, { error: "INVALID_IMGUR_URL" });
  if (image && (await tooLarge(image)))
    return reply(413, {
      error: "CUSTOM_IMAGE_TOO_LARGE",
      maxBytes: CUSTOM_IMAGE_MAX_BYTES
    });
  const { data: card, error: saveError } = await serviceClient().rpc(
    "set_card_custom_image_for_player",
    {
      p_player: player,
      p_card_instance_id: instanceId,
      p_image_url: image || null
    }
  );
  if (saveError) {
    const code = KNOWN_ERRORS.has(saveError.message)
      ? saveError.message
      : "CUSTOM_IMAGE_SAVE_FAILED";
    return reply(code === "CUSTOM_IMAGE_SAVE_FAILED" ? 502 : 400, {
      error: code
    });
  }
  return reply(200, { card });
}
