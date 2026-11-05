import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
test("maintenance gifts are durable, idempotent, isolated from timed/referral packs and private", async () => {
  const { db } = await replayMigrations();
  const user = "ed000000-0000-4000-8000-000000000001";
  try {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",
      [user, JSON.stringify({ pseudo: "GiftFixture" })]
    );
    for (const rarity of ["C", "R", "SR", "SSR", "LR"])
      await db.query(
        "insert into public.cards(source_id,nom,categorie,franchise,rarete_base,image_url,source) values($1,$1,'Anime/Manga','Gifts',$2,'https://example.test/gift.png','test')",
        ["gift-" + rarity, rarity]
      );
    const grant = readFileSync(
      "scripts/sql/grant-maintenance-20261105.sql",
      "utf8"
    );
    const before = (
      await db.query(
        "select next_regular_pack_at from public.user_profiles where user_id=$1",
        [user]
      )
    ).rows[0].next_regular_pack_at;
    await db.exec(grant);
    await db.exec(grant);
    assert.equal(
      Number(
        (
          await db.query(
            "select bonus_regular_packs from public.user_profiles where user_id=$1",
            [user]
          )
        ).rows[0].bonus_regular_packs
      ),
      25
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user
    ]);
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query("select * from public.maintenance_pack_grants")
    );
    let status = (await db.query("select public.get_decision_pack_status() s"))
      .rows[0].s;
    assert.equal(status.remaining, 2);
    assert.equal(status.bonus, 1);
    await db.exec("reset role");
    await db.query(
      "update public.maintenance_pack_grants set granted_at=granted_at-interval '30 days' where user_id=$1",
      [user]
    );
    await db.exec("set role authenticated");
    assert.equal(
      (await db.query("select public.get_decision_pack_status() s")).rows[0].s
        .bonus,
      1
    );
    const choices = (await db.query("select public.open_decision_pack() s"))
      .rows[0].s;
    assert.deepEqual(
      (await db.query("select public.open_decision_pack() s")).rows[0].s,
      choices
    );
    await db.query("select public.keep_decision_pack_card($1)", [
      choices[0].instanceId
    ]);
    status = (await db.query("select public.get_decision_pack_status() s"))
      .rows[0].s;
    assert.equal(status.remaining, 1);
    assert.equal(status.bonus, 0);
    await db.query("select public.open_regular_pack()");
    await db.exec("reset role");
    assert.equal(
      (
        await db.query(
          "select source from public.regular_pack_openings where opened_by=$1",
          [user]
        )
      ).rows[0].source,
      "maintenance_compensation"
    );
    assert.equal(
      Number(
        (
          await db.query(
            "select regular_remaining from public.maintenance_pack_grants where user_id=$1",
            [user]
          )
        ).rows[0].regular_remaining
      ),
      24
    );
    assert.equal(
      String(
        (
          await db.query(
            "select next_regular_pack_at from public.user_profiles where user_id=$1",
            [user]
          )
        ).rows[0].next_regular_pack_at
      ),
      String(before)
    );
    await db.exec(grant);
    assert.equal(
      Number(
        (
          await db.query(
            "select bonus_regular_packs from public.user_profiles where user_id=$1",
            [user]
          )
        ).rows[0].bonus_regular_packs
      ),
      24
    );
    // Simulate a later daily window: only the daily quota resets, no bonus reappears.
    await db.query(
      "update public.decision_packs set created_at=created_at-interval '2 days' where user_id=$1",
      [user]
    );
    await db.exec("set role authenticated");
    status = (await db.query("select public.get_decision_pack_status() s"))
      .rows[0].s;
    assert.equal(status.remaining, 1);
    assert.equal(status.bonus, 0);
  } finally {
    await db.close();
  }
});
