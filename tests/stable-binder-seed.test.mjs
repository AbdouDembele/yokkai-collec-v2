import test from "node:test";
import assert from "node:assert/strict";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
import { prepareSeed } from "../scripts/prepare-stable-binder-seed.mjs";

test("seed preserves historical exclusions and skips missing or edited cards without rewriting the catalogue", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const add = async source_id =>
    (
      await db.query(
        "insert into public.cards(source_id,nom,source,categorie,franchise,rarete_base,image_url) values($1,'Seed fixture','anilist','ANIME/MANGA','Seed Original','C','https://example.test/seed.png') returning to_jsonb(cards) as snapshot",
        [source_id]
      )
    ).rows[0].snapshot;
  const intact = await add("101"),
    edited = await add("102"),
    removed = await add("103"),
    missing = await add("104");
  await db.query(
    "insert into public.anime_series_protected_cards values($1,'Historical manual exclusion')",
    [removed.id]
  );
  await db.query("delete from public.cards where id=$1", [removed.id]);
  await db.query("delete from public.cards where id=$1", [missing.id]);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.anime_series_protected_cards where card_id=$1",
        [removed.id]
      )
    ).rows[0].n,
    1
  );
  await db.query(
    "update public.cards set description='Operator change' where id=$1",
    [edited.id]
  );
  const protectedRows = Array.from({ length: 1326 }, (_, i) => ({
    card_id: "b0000000-0000-4000-8000-" + String(i + 1).padStart(12, "0"),
    exclusion_reason: "Independent historical exclusion"
  }));
  const binder = "b1000000-0000-4000-8000-000000000001",
    digest = "a".repeat(64);
  const mapping = {
    production_approved: false,
    media_rules: [
      {
        media_id: 1001,
        series_media_id: 1001,
        binder_id: binder,
        display_name: "Approved Seed Series",
        decision: "A"
      }
    ],
    assignments: [intact, edited, removed, missing].map(c => ({
      card_id: c.id,
      character_id: Number(c.source_id),
      source_license: c.franchise,
      media_id: 1001,
      verified_snapshot: c,
      import_evidence_sha256: digest
    }))
  };
  const baseline = (
    await db.query(
      "select jsonb_agg(to_jsonb(c) order by id) value from public.cards c"
    )
  ).rows[0].value;
  const { sql } = prepareSeed(
    mapping,
    protectedRows,
    {},
    {
      mapping_sha256: digest,
      editorial_approved: true,
      production_approved: false
    },
    digest
  );
  await db.exec(sql);
  assert.deepEqual(
    (await db.query("select card_id from public.anime_series_card_assignments"))
      .rows,
    [{ card_id: intact.id }]
  );
  assert.deepEqual(
    (
      await db.query(
        "select jsonb_agg(to_jsonb(c) order by id) value from public.cards c"
      )
    ).rows[0].value,
    baseline
  );
  assert.equal(
    (await db.query("select enabled from public.anime_series_settings")).rows[0]
      .enabled,
    false
  );
  await db.exec(
    "update public.anime_series_settings set mapping_version='another-mapping'"
  );
  await assert.rejects(db.exec(sql), /BINDER_SEED_VERSION_CONFLICT/);
  await db.exec("rollback");
});
