import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

test("private receipts: exact own projection, independent server acknowledgements and no player mutations", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const a = "72000000-0000-4000-8000-000000000001",
    b = "72000000-0000-4000-8000-000000000002";
  const insert = async (user, key, published) =>
    (
      await db.query(
        `insert into public.account_sanctions(operation_id,user_id,sanction_type,reason,card_action,kara_action,cards_removed,kara_removed,kara_balance_before,kara_balance_after,applied_at,status,published_at,metadata)
  values($1,$2,'AFFILIATE_ABUSE_WARNING','AFFILIATE_ABUSE','NONE','NONE',0,0,123,123,clock_timestamp(),'APPLIED',case when $3 then clock_timestamp() end,jsonb_build_object('secret','private evidence')) returning id`,
        [key, user, published]
      )
    ).rows[0].id;
  const first = await insert(a, "fixture-operation-one", true),
    second = await insert(a, "fixture-operation-two", true),
    hidden = await insert(a, "fixture-operation-unpublished", false),
    other = await insert(b, "fixture-operation-other", true);
  for (const role of ["anon", "authenticated", "service_role"]) {
    const access = (
      await db.query(
        `select has_table_privilege($1,'public.account_sanctions','SELECT') r,has_table_privilege($1,'public.account_sanctions','UPDATE') u,has_table_privilege($1,'public.account_sanctions','DELETE') d,has_table_privilege($1,'public.account_sanctions','INSERT') i`,
        [role]
      )
    ).rows[0];
    assert.deepEqual(access, { r: false, u: false, d: false, i: false });
    for (const signature of [
      "public.get_my_pending_sanctions()",
      "public.acknowledge_my_sanction(uuid)"
    ])
      assert.equal(
        (
          await db.query("select has_function_privilege($1,$2,'EXECUTE') ok", [
            role,
            signature
          ])
        ).rows[0].ok,
        role === "authenticated"
      );
  }
  await db.exec(
    `set role authenticated;select set_config('request.jwt.claim.sub','${a}',false)`
  );
  const pending = (
    await db.query("select * from public.get_my_pending_sanctions()")
  ).rows;
  assert.deepEqual(
    pending.map(x => x.sanction_id),
    [first, second]
  );
  assert.deepEqual(Object.keys(pending[0]).sort(), [
    "applied_at",
    "cards_removed",
    "kara_removed",
    "sanction_id",
    "sanction_type"
  ]);
  for (const id of [other, hidden, "72000000-0000-4000-8000-999999999999"])
    assert.equal(
      (await db.query("select public.acknowledge_my_sanction($1) ok", [id]))
        .rows[0].ok,
      false
    );
  for (const sql of [
    "select * from public.account_sanctions",
    `update public.account_sanctions set cards_removed=99`,
    `update public.account_sanctions set kara_removed=0`,
    `update public.account_sanctions set status='ROLLED_BACK'`,
    `delete from public.account_sanctions`
  ])
    await assert.rejects(db.exec(sql), /permission denied/);
  assert.equal(
    (await db.query("select public.acknowledge_my_sanction($1) ok", [first]))
      .rows[0].ok,
    true
  );
  await db.exec("reset role");
  const stamp = (
    await db.query(
      "select notification_seen_at from public.account_sanctions where id=$1",
      [first]
    )
  ).rows[0].notification_seen_at;
  assert(stamp);
  await db.exec("set role authenticated");
  assert.deepEqual(
    (
      await db.query(
        "select sanction_id from public.get_my_pending_sanctions()"
      )
    ).rows,
    [{ sanction_id: second }]
  );
  assert.equal(
    (await db.query("select public.acknowledge_my_sanction($1) ok", [first]))
      .rows[0].ok,
    true
  );
  await db.exec("reset role");
  assert.equal(
    String(
      (
        await db.query(
          "select notification_seen_at from public.account_sanctions where id=$1",
          [first]
        )
      ).rows[0].notification_seen_at
    ),
    String(stamp)
  );
  assert.equal(
    (await db.query("select count(*)::int n from public.account_sanctions"))
      .rows[0].n,
    4
  );
  await assert.rejects(
    insert(a, "fixture-operation-one", true),
    /duplicate key/
  );
});

test("atomic exact scope preserves gifts and third parties, rounds down, rolls back on failure and never repeats", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const ids = [1, 2, 3, 4].map(
    n => `73000000-0000-4000-8000-${String(n).padStart(12, "0")}`
  );
  for (let i = 0; i < 4; i++)
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [ids[i], JSON.stringify({ pseudo: "SanctionFixture" + i })]
    );
  await db.query(
    "update public.user_profiles set karas_balance=case when user_id=$1 then 580 when user_id=$2 then 661 else 1512 end",
    [ids[0], ids[1]]
  );
  const card = (
    await db.query(
      `insert into public.cards(source,source_id,nom,categorie,franchise,rarete_base,image_url) values('manual','sanction-fixture','Fixture','TEST','TEST','C','https://example.invalid/card.png') returning id`
    )
  ).rows[0].id;
  const copies = [];
  for (let i = 0; i < 77; i++)
    copies.push(
      (
        await db.query(
          "insert into public.user_cards(user_id,card_id,rarity) values($1,$2,'C') returning id",
          [
            i === 74 ? ids[3] : i === 75 ? ids[1] : i === 76 ? ids[2] : ids[0],
            card
          ]
        )
      ).rows[0].id
    );
  await db.exec(`create temp table sanction_scope(user_id uuid,operation_id text,sanction_type text,expected_pseudo text,remove_cards boolean,penalize boolean);
  create temp table sanction_targets(id uuid);create temp table sanction_config(metadata jsonb,quiescent boolean);
  insert into sanction_config values(jsonb_build_object('fixture',true),false);`);
  for (let i = 0; i < 3; i++)
    await db.query("insert into sanction_scope values($1,$2,$3,$4,$5,$6)", [
      ids[i],
      "test-authorized-batch-" + i,
      [
        "AFFILIATE_ABUSE_SANCTION",
        "AFFILIATE_ABUSE_WARNING_WITH_PENALTY",
        "AFFILIATE_ABUSE_WARNING"
      ][i],
      "SanctionFixture" + i,
      i === 0,
      i < 2
    ]);
  for (const id of copies.slice(0, 75))
    await db.query("insert into sanction_targets values($1)", [id]);
  const apply = readFileSync(
    "scripts/sql/apply-referral-sanctions.sql",
    "utf8"
  );
  await db.query("update public.user_cards set is_locked=true where id=$1", [
    copies[0]
  ]);
  await db.exec("begin");
  await assert.rejects(db.exec(apply), /TARGET_LOCKED_STOP/);
  await db.exec("rollback");
  assert.equal(
    (await db.query("select count(*)::int n from public.account_sanctions"))
      .rows[0].n,
    0
  );
  assert.equal(
    (
      await db.query(
        "select karas_balance from public.user_profiles where user_id=$1",
        [ids[0]]
      )
    ).rows[0].karas_balance,
    580
  );
  await db.query("update public.user_cards set is_locked=false where id=$1", [
    copies[0]
  ]);
  await db.exec("begin");
  await db.exec(apply);
  await db.exec("commit");
  const result = (
    await db.query(
      "select user_id,cards_removed,kara_removed,kara_balance_before,kara_balance_after,published_at,metadata from public.account_sanctions order by user_id"
    )
  ).rows;
  assert.deepEqual(
    result.map(r => [
      r.cards_removed,
      r.kara_removed,
      r.kara_balance_before,
      r.kara_balance_after,
      r.published_at
    ]),
    [
      [74, 290, 580, 290, null],
      [0, 330, 661, 331, null],
      [0, 0, 1512, 1512, null]
    ]
  );
  assert(
    result.every(
      r => r.metadata.kara_provenance === "NOT_PROVEN_FRAUD_PROCEEDS"
    )
  );
  assert.equal(result[0].metadata.removed_cards.length, 74);
  assert.deepEqual(
    (
      await db.query("select id,user_id from public.user_cards order by id")
    ).rows.sort((a, b) => a.id.localeCompare(b.id)),
    [74, 75, 76]
      .map(i => ({
        id: copies[i],
        user_id: ids[i === 74 ? 3 : i === 75 ? 1 : 2]
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
  );
  await db.exec("begin");
  await db.exec(apply);
  await db.exec("commit");
  assert.equal(
    (await db.query("select count(*)::int n from public.account_sanctions"))
      .rows[0].n,
    3
  );
  assert.equal(
    (
      await db.query(
        "select karas_balance from public.user_profiles where user_id=$1",
        [ids[1]]
      )
    ).rows[0].karas_balance,
    331
  );
  const rollback = readFileSync(
    "scripts/sql/rollback-referral-sanctions.sql",
    "utf8"
  );
  await db.query(
    "update public.user_profiles set karas_balance=karas_balance+1 where user_id=$1",
    [ids[1]]
  );
  await db.exec("begin");
  await assert.rejects(db.exec(rollback), /PLAYER_STATE_CHANGED_STOP/);
  await db.exec("rollback");
  assert.equal(
    (await db.query("select count(*)::int n from public.user_cards")).rows[0].n,
    3
  );
  await db.query(
    "update public.user_profiles set karas_balance=karas_balance-1 where user_id=$1",
    [ids[1]]
  );
  await db.exec("begin");
  await db.exec(rollback);
  await db.exec("commit");
  assert.equal(
    (await db.query("select count(*)::int n from public.user_cards")).rows[0].n,
    77
  );
  assert.equal(
    (
      await db.query(
        "select karas_balance from public.user_profiles where user_id=$1",
        [ids[1]]
      )
    ).rows[0].karas_balance,
    661
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.account_sanctions where status='ROLLED_BACK'"
      )
    ).rows[0].n,
    3
  );
  await db.exec("begin");
  await assert.rejects(db.exec(apply), /EXISTING_PARTIAL_OR_ROLLED_BACK_BATCH/);
  await db.exec("rollback");
});
