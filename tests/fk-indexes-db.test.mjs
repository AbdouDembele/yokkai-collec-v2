import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const migration = "20261019030000_perf_04_fk_indexes.sql";
const targets = [
  ["billing_webhook_events", "account_id"],
  ["decision_packs", "user_id"],
  ["decision_packs", "kept_choice_id"],
  ["auctions", "card_instance_id"],
  ["card_shares", "card_id"],
  ["decision_pack_choices", "card_id"],
  ["user_profiles", "banner_card_id"],
  ["user_cards", "user_id", "folder_id"]
];

test("PERF-04 access paths have complete, valid leading-column B-tree indexes", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const indexes = async () =>
    (
      await db.query(`select i.indexrelid::regclass::text as name,
      i.indrelid::regclass::text as table_name,
      array(select a.attname from unnest(i.indkey::smallint[]) with ordinality k(num,pos)
        join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.num
        where k.pos<=i.indnkeyatts order by k.pos) as columns
      from pg_index i join pg_class c on c.oid=i.indexrelid
      join pg_am am on am.oid=c.relam
      where i.indrelid in (${targets.map(([table]) => `'public.${table}'::regclass`).join(",")})
        and i.indisvalid and i.indisready and i.indpred is null
        and i.indexprs is null and am.amname='btree'
      order by name`)
    ).rows;
  const actual = await indexes();
  const missing = targets.filter(
    ([table, ...columns]) =>
      !actual.some(
        i =>
          i.table_name === table &&
          columns.every((column, n) => i.columns[n] === column)
      )
  );
  assert.deepEqual(missing, [], "Missing complete leading-column FK indexes");

  // Prove the indexes are usable without a status predicate (including sold
  // auctions and claimed packs). This is eligibility, not a latency benchmark.
  await db.exec("set enable_seqscan=off");
  for (const [table, ...columns] of targets) {
    const predicate = columns
      .map(column => `${column}='10000000-0000-4000-8000-000000000001'::uuid`)
      .join(" and ");
    const plan = JSON.stringify(
      (
        await db.query(
          `explain (format json) select 1 from public.${table} where ${predicate}`
        )
      ).rows
    );
    assert.match(plan, /Index (Only )?Scan|Bitmap Index Scan/, table);
    for (const column of columns)
      assert.ok(plan.includes(column), `${table}.${column}`);
  }
  await db.exec("reset enable_seqscan");

  // Reapplication must neither duplicate indexes nor leak the local timeout.
  const timeout = (await db.query("show lock_timeout")).rows;
  await db.exec(
    readFileSync(
      new URL(`../supabase/migrations/${migration}`, import.meta.url),
      "utf8"
    )
  );
  assert.deepEqual(await indexes(), actual);
  assert.deepEqual((await db.query("show lock_timeout")).rows, timeout);
});
