const privateHeaders = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin"
};

/** Bounded, sniffed image response; never cached by shared caches. @param {Blob} blob */
export async function wallMediaResponse(blob) {
  const fail = status =>
    new Response(null, { status, headers: privateHeaders });
  if (blob.size > 6 * 1024 * 1024) return fail(413);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const prefix = new TextDecoder().decode(bytes.slice(0, 12));
  const mime =
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      ? "image/jpeg"
      : [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)
        ? "image/png"
        : prefix.startsWith("GIF87a") || prefix.startsWith("GIF89a")
          ? "image/gif"
          : prefix.startsWith("RIFF") && prefix.slice(8, 12) === "WEBP"
            ? "image/webp"
            : null;
  if (!mime) return fail(415);
  return new Response(bytes, {
    headers: {
      ...privateHeaders,
      "Content-Type": mime,
      "Content-Disposition": "inline"
    }
  });
}

/** @param {string} id @param {import("@supabase/supabase-js").SupabaseClient} client @param {boolean} reply */
export async function serveWallMedia(id, client, reply = false) {
  const fail = status =>
    new Response(null, { status, headers: privateHeaders });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404);
  try {
    const { data: session, error: authError } = await client.auth.getUser();
    if (authError || !session.user) return fail(401);
    // RLS is checked for the post AND again during download. No service-role bypass.
    const lookup = reply
      ? await client.rpc("get_wall_reply_media", { p_id: id })
      : await client
          .from("profile_wall_posts")
          .select("media_path")
          .eq("id", id)
          .maybeSingle();
    const path = reply ? lookup.data : lookup.data?.media_path;
    if (lookup.error || !path) return fail(404);
    const { data: blob, error: downloadError } = await client.storage
      .from("profile-wall-media")
      .download(path);
    if (downloadError || !blob) return fail(404);
    return await wallMediaResponse(blob);
  } catch {
    return fail(503);
  }
}
