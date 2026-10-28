const mediaPath = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/i;

// Paths must come from a protected deletion RPC, never directly from a form.
export async function removeWallMedia(paths, storageClient) {
  if (
    !Array.isArray(paths) ||
    paths.some(path => typeof path !== "string" || !mediaPath.test(path))
  )
    throw new Error("Invalid cleanup response");
  if (!paths.length) return;
  const storage = storageClient().storage.from("profile-wall-media");
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await storage.remove(paths.slice(i, i + 100));
    if (error) throw new Error("Wall media cleanup failed");
  }
}

export async function discardAuthorizedWallMedia(client, input, storageClient) {
  const paths = Array.isArray(input) ? input : [input];
  if (paths.some(path => typeof path !== "string" || !mediaPath.test(path)))
    return { ok: false };
  try {
    const authorized = [];
    for (const path of paths) {
      const { data, error } = await client.rpc(
        "authorize_wall_reply_media_cleanup",
        { p_path: path }
      );
      if (error || (data !== null && data !== path)) return { ok: false };
      if (data !== null) authorized.push(data);
    }
    await removeWallMedia(authorized, storageClient);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function deleteOwnWallPost(client, id, storageClient) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))
    return { ok: false };
  const { data, error } = await client.rpc("delete_profile_wall_post", {
    p_id: id
  });
  if (error) return { ok: false };
  try {
    // Before the migration, only the author's scalar path is returned. Keep its
    // existing owner-scoped Storage policy, with no privileged fallback.
    if (data === null || (typeof data === "string" && mediaPath.test(data))) {
      await removeWallMedia(data === null ? [] : [data], () => client);
      return { ok: true };
    }
    const result = JSON.parse(data);
    if (!Array.isArray(result.mediaPaths)) return { ok: false };
    return discardAuthorizedWallMedia(client, result.mediaPaths, storageClient);
  } catch {
    return { ok: false };
  }
}
