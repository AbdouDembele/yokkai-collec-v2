import { discardAuthorizedWallMedia } from "./wall-media-cleanup.mjs";

// Trusted server caller: the authenticated RPC checks admin membership before
// returning any cleanup paths. Never accept storage paths from form fields.
export async function deleteReportedWallContent(
  client,
  reportId,
  storageClient
) {
  const { data, error } = await client.rpc(
    "admin_delete_reported_wall_content",
    { p_report_id: reportId }
  );
  if (error)
    return {
      ok: false,
      message: "Couldn't delete this content. Please try again."
    };
  try {
    if (!Array.isArray(data.mediaPaths))
      throw new Error("Invalid cleanup response");
    if (
      !(
        await discardAuthorizedWallMedia(client, data.mediaPaths, storageClient)
      ).ok
    )
      throw new Error("Media cleanup failed");
    return {
      ok: true,
      contentDeleted: true,
      message: data.alreadyDeleted
        ? "This content was already deleted."
        : "Content deleted."
    };
  } catch {
    return {
      ok: false,
      contentDeleted: true,
      message:
        "Content deleted, but media cleanup failed. Retry to finish removing the files."
    };
  }
}

// #379: hide a reported DM, or only the image/GIF of a wall item. Returns stable
// codes; the admin page translates them. Paths only come from the admin RPC.
export async function moderateReportedContent(client, reportId, storageClient) {
  const { data, error } = await client.rpc("admin_moderate_reported_content", {
    p_report_id: reportId
  });
  if (error)
    return {
      ok: false,
      code:
        error.message === "MODERATION_TEXT_REQUIRED" ? "textRequired" : "failed"
    };
  try {
    if (!Array.isArray(data?.mediaPaths))
      throw new Error("Invalid cleanup response");
    if (
      data.mediaPaths.length &&
      !(
        await discardAuthorizedWallMedia(client, data.mediaPaths, storageClient)
      ).ok
    )
      throw new Error("Media cleanup failed");
    return {
      ok: true,
      removed: true,
      code: data.alreadyRemoved ? "alreadyRemoved" : "removed"
    };
  } catch {
    return { ok: false, removed: true, code: "cleanupFailed" };
  }
}
