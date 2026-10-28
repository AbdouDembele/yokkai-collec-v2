import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteOwnWallPost,
  discardAuthorizedWallMedia,
  removeWallMedia
} from "../lib/server/wall-media-cleanup.mjs";
const id = "96000000-0000-4000-8000-000000000001";
const path = `${id}/96000000-0000-4000-8000-000000000002.png`;
const other = `96000000-0000-4000-8000-000000000003/96000000-0000-4000-8000-000000000004.png`;
test("post deletion uses only SQL paths, exact authorization, shared cleanup and idempotent retry", async () => {
  let fail = true,
    deleted = false;
  const calls = [],
    removed = [];
  const client = {
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === "delete_profile_wall_post") {
        assert.deepEqual(args, { p_id: id });
        const alreadyDeleted = deleted;
        deleted = true;
        return {
          data: JSON.stringify({ mediaPaths: [path, other], alreadyDeleted })
        };
      }
      assert.equal(name, "authorize_wall_reply_media_cleanup");
      return { data: args.p_path };
    }
  };
  const storage = () => ({
    storage: {
      from: () => ({
        remove: async paths => {
          removed.push(paths);
          return { error: fail ? {} : null };
        }
      })
    }
  });
  assert.equal((await deleteOwnWallPost(client, id, storage)).ok, false);
  fail = false;
  assert.equal((await deleteOwnWallPost(client, id, storage)).ok, true);
  assert.deepEqual(removed, [
    [path, other],
    [path, other]
  ]);
  assert.equal(
    calls.filter(([name]) => name === "delete_profile_wall_post").length,
    2
  );
  let privileged = false;
  const denied = {
    rpc: async () => ({ error: { message: "WALL_MEDIA_INVALID" } })
  };
  assert.equal(
    (
      await discardAuthorizedWallMedia(denied, other, () => {
        privileged = true;
      })
    ).ok,
    false
  );
  assert.equal(privileged, false);
  await assert.rejects(
    removeWallMedia(["../unsafe"], storage),
    /Invalid cleanup/
  );
  assert.equal(
    (await deleteOwnWallPost(client, "not-an-id", storage)).ok,
    false
  );
});
test("legacy deletion stays on the authenticated Storage client; absent bytes skip privileged client", async () => {
  let removed = [];
  const client = {
    rpc: async () => ({ data: path }),
    storage: {
      from: () => ({
        remove: async paths => {
          removed = paths;
          return {};
        }
      })
    }
  };
  const forbidden = () => {
    throw new Error("Must not use service role");
  };
  assert.equal((await deleteOwnWallPost(client, id, forbidden)).ok, true);
  assert.deepEqual(removed, [path]);
  assert.equal(
    (
      await discardAuthorizedWallMedia(
        { rpc: async () => ({ data: null }) },
        other,
        forbidden
      )
    ).ok,
    true
  );
});
