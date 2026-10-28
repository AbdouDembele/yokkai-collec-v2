/** @param {string} userId @param {import("@supabase/supabase-js").SupabaseClient} admin
 * @param {(() => Promise<void>) | undefined} cancelBilling */
export async function deleteAccount(userId, admin, cancelBilling) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      userId
    )
  )
    throw new Error("INVALID_ACCOUNT");
  const started = await admin.rpc("begin_account_deletion", {
    p_user_id: userId
  });
  if (started.error) throw new Error("ACCOUNT_DELETION_START_FAILED");
  // Fence is committed first: a failure below remains resumable, never permits
  // the old JWT to recreate personal data, and never refunds an auction twice.
  let prepared = await admin.rpc("prepare_account_deletion", {
    p_user_id: userId
  });
  if (prepared.error?.message === "BILLING_CANCELLATION_REQUIRED") {
    if (!cancelBilling) throw new Error("ACCOUNT_DELETION_BILLING_REQUIRED");
    try {
      await cancelBilling();
    } catch {
      throw new Error("ACCOUNT_DELETION_BILLING_FAILED");
    }
    prepared = await admin.rpc("prepare_account_deletion", {
      p_user_id: userId
    });
  }
  if (prepared.error) throw new Error("ACCOUNT_DELETION_PREPARATION_FAILED");
  const objects = prepared.data;
  if (
    !Array.isArray(objects) ||
    objects.some(
      o =>
        !o ||
        !["avatars", "profile-wall-media"].includes(o.bucket) ||
        typeof o.name !== "string" ||
        !o.name.startsWith(`${userId}/`) ||
        o.name.split("/").some(segment => segment === "." || segment === "..")
    )
  )
    throw new Error("ACCOUNT_DELETION_STORAGE_MANIFEST_INVALID");
  for (const bucket of ["avatars", "profile-wall-media"]) {
    const names = objects.filter(o => o.bucket === bucket).map(o => o.name);
    for (let i = 0; i < names.length; i += 100) {
      const { error } = await admin.storage
        .from(bucket)
        .remove(names.slice(i, i + 100));
      if (error) throw new Error("ACCOUNT_DELETION_STORAGE_FAILED");
    }
  }
  // Hard deletion removes email, identities and sessions through Auth's own API.
  const { error } = await admin.auth.admin.deleteUser(userId, false);
  if (error && error.code !== "user_not_found")
    throw new Error("ACCOUNT_DELETION_AUTH_FAILED");
}
