import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("profile image migration increases only the avatars limit and preserves MIME restrictions and RLS", async t => {
  const directory = new URL("../supabase/migrations/", import.meta.url);
  const filename = "20261015200000_profile_images_4mb.sql";
  const migrations = readdirSync(directory)
    .filter(file => file.endsWith(".sql") && file < filename)
    .sort();
  const { db } = await replayMigrations({ migrations });
  t.after(() => db.close());
  const buckets = async () =>
    (await db.query("select * from storage.buckets order by id")).rows;
  const policies = async () =>
    (
      await db.query(
        "select * from pg_policies where schemaname='storage' order by tablename,policyname"
      )
    ).rows;
  const before = await buckets();
  const beforePolicies = await policies();
  assert.equal(
    Number(before.find(bucket => bucket.id === "avatars").file_size_limit),
    2097152
  );
  const sql = readFileSync(new URL(filename, directory), "utf8");
  await db.exec(sql);
  const after = await buckets();
  assert.deepEqual(
    after,
    before.map(bucket =>
      bucket.id === "avatars" ? { ...bucket, file_size_limit: 4194304 } : bucket
    )
  );
  assert.deepEqual(await policies(), beforePolicies);
  const avatar = after.find(bucket => bucket.id === "avatars");
  assert.deepEqual(avatar.allowed_mime_types, [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif"
  ]);
  await db.exec(sql);
  assert.deepEqual(await buckets(), after, "migration is idempotent");
});
