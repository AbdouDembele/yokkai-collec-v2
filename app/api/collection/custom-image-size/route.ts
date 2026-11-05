import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  CUSTOM_IMAGE_MAX_BYTES,
  imgurGifVideo
} from "@/lib/ui/custom-image-media";

// Same hosts as set_card_custom_image: no request ever leaves for another host.
const ALLOWED = /^https:\/\/((i\.)?imgur\.com|i\.pinimg\.com)\/\S+$/i;

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

// Signed-in players check the weight of custom card art before choosing it:
// cards download it on every grid and showcase. Unknown sizes are accepted.
export async function POST(request: Request) {
  const reply = (status: number, body?: object) =>
    Response.json(body ?? {}, {
      status,
      headers: { "Cache-Control": "private, no-store" }
    });
  const client = createClient(await cookies());
  const { data, error } = await client.auth.getClaims();
  if (error || typeof data?.claims?.sub !== "string") return reply(401);
  let url: unknown;
  try {
    url = ((await request.json()) as { url?: unknown })?.url;
  } catch {
    return reply(400);
  }
  if (typeof url !== "string" || url.length > 2048 || !ALLOWED.test(url))
    return reply(400, { error: "INVALID_IMGUR_URL" });
  // What cards download: the MP4 for Imgur GIFs (when it exists), else the file.
  const video = imgurGifVideo(url);
  const served = (video && (await contentLength(video))) || null;
  const size = served?.ok === true ? served : await contentLength(url);
  if (size.ok && size.bytes !== null && size.bytes > CUSTOM_IMAGE_MAX_BYTES)
    return reply(413, {
      error: "CUSTOM_IMAGE_TOO_LARGE",
      maxBytes: CUSTOM_IMAGE_MAX_BYTES
    });
  return reply(200, { ok: true });
}
