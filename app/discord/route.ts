import { NextResponse } from "next/server";
import { getDiscordInviteUrl } from "@/lib/discord-invite";

export function GET() {
  const inviteUrl = getDiscordInviteUrl();

  if (!inviteUrl) {
    return new Response(
      "The Yokkai Discord invite is temporarily unavailable.",
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8",
          "X-Robots-Tag": "noindex, nofollow"
        }
      }
    );
  }

  const response = NextResponse.redirect(inviteUrl, 307);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}
