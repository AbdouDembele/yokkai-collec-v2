import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { serveWallMedia } from "@/lib/server/profile-wall-media.mjs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  return serveWallMedia(id, createClient(await cookies()), true);
}
