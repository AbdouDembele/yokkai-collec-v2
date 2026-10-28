import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const filename = "20261015190000_english_achievement_texts.sql";
const directory = new URL("../supabase/migrations/", import.meta.url);
const migration = readFileSync(new URL(filename, directory), "utf8");
const rollback = readFileSync(
  new URL("../docs/english-achievements.md", import.meta.url),
  "utf8"
).match(/```sql\r?\n([\s\S]*?)\r?\n```/)[1];

test("English achievement text preserves rules and player data, is idempotent and rolls back", async t => {
  const { db } = await replayMigrations({
    migrations: readdirSync(directory)
      .filter(name => name.endsWith(".sql") && name !== filename)
      .sort()
  });
  t.after(() => db.close());
  await db.exec(`
    -- Reproduce the label observed on the VPS; migration replay already has a newer French label.
    update public.achievements set description = 'Évoluer une première carte SSR en LR.' where id = 'transcendance';
    insert into auth.users(id, raw_user_meta_data) values ('10000000-0000-4000-8000-000000000001', '{"pseudo":"EnglishProof"}');
    insert into public.user_achievements(user_id, achievement_id, completed_at, claimed_at)
      values ('10000000-0000-4000-8000-000000000001', 'premier-rituel', '2026-10-01T00:00:00Z', '2026-10-01T00:01:00Z');
    insert into public.notifications(user_id, type, achievement_id) values ('10000000-0000-4000-8000-000000000001', 'achievement_completed', 'premier-rituel');
  `);
  const definitions = async () =>
    (await db.query("select * from public.achievements order by id")).rows;
  const players = async () => {
    const result = {};
    for (const table of [
      "user_profiles",
      "user_cards",
      "user_achievement_stats",
      "user_achievements",
      "notifications"
    ])
      result[table] = (
        await db.query(
          `select to_jsonb(entry) as value from public.${table} entry order by to_jsonb(entry)::text`
        )
      ).rows;
    return result;
  };
  const before = await definitions();
  const originalPlayers = await players();
  await db.exec(migration);
  const english = await definitions();
  assert.equal(english.length, 11);
  assert.equal(
    english.find(item => item.id === "transcendance").description,
    "Obtain your first evolved Shiny SSR card."
  );
  for (let index = 0; index < before.length; index++) {
    const {
      titre: oldTitle,
      description: oldDescription,
      ...oldRule
    } = before[index];
    const { titre, description, ...rule } = english[index];
    assert.deepEqual(rule, oldRule);
    assert.notEqual(titre, oldTitle);
    assert.notEqual(description, oldDescription);
    assert.doesNotMatch(titre + description, /[éèàâêîùçœ]/i);
  }
  assert.deepEqual(await players(), originalPlayers);
  await db.exec(migration);
  assert.deepEqual(await definitions(), english);
  assert.deepEqual(await players(), originalPlayers);
  await db.exec(rollback);
  assert.deepEqual(await definitions(), before);
  await db.exec(rollback);
  assert.deepEqual(await definitions(), before);
  assert.deepEqual(await players(), originalPlayers);
});
