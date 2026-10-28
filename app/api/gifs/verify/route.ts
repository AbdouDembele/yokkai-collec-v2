import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { storageAdminClient } from "@/lib/server/admin-wall-content";
import { verifyGifRating } from "@/lib/server/gif-rating.mjs";

// #379 (C2): signed-in players ask the server to verify a GIF before posting it.
export async function POST(request: Request) {
  const reply = (status: number, body?: object) =>
    Response.json(body ?? {}, {
      status,
      headers: { "Cache-Control": "private, no-store" }
    });
  const client = createClient(await cookies());
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return reply(401);
  let id: unknown;
  try {
    id = ((await request.json()) as { id?: unknown })?.id;
  } catch {
    return reply(400);
  }
  const result = await verifyGifRating({
    id,
    apiKey: process.env.GIPHY_API_KEY || process.env.NEXT_PUBLIC_GIPHY_API_KEY,
    // The player's session: ban check and per-player limit before GIPHY.
    consume: async (gifId: string) => {
      const { data: cached, error: limitError } = await client.rpc(
        "consume_gif_verification",
        { p_gif_id: gifId }
      );
      if (limitError) throw limitError;
      return cached as string | null;
    },
    fetchGif: (url: string) =>
      fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000) }),
    record: async (gifId: string, rating: string) => {
      const { error: recordError } = await storageAdminClient().rpc(
        "record_giphy_gif_rating",
        { p_gif_id: gifId, p_rating: rating }
      );
      if (recordError) throw recordError;
    }
  });
  return reply(
    result.status,
    result.status === 200 ? { allowed: result.allowed } : undefined
  );
}
