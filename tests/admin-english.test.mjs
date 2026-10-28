import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = p => readFileSync(new URL("../" + p, import.meta.url), "utf8");
test("ENG-01 admin navigation, errors and removal dialogs are English", () => {
  assert.match(read("app/admin/admin-navigation.tsx"), /Card publishing/);
  assert.match(
    read("lib/auth/admin.ts"),
    /This action is restricted to administrators\./
  );
  const collection = read("components/collection.tsx");
  assert.match(collection, /Remove this card\?/);
  assert.doesNotMatch(
    collection,
    /Retirer cette carte|Retrait…|Carte actuellement aux enchères/
  );
  const community = read("components/community-views.tsx");
  assert.match(community, /h\.name === "Joueur supprimé"/);
  assert.match(community, /h\.name === "Deleted player"/);
});

test("ENG-01 migration changes only admin SQL fallback literals", () => {
  const migration = read(
    "supabase/migrations/20261019030002_english_admin_fallbacks.sql"
  );
  const definitions = [
    [
      "20261009000000_admin_player_management.sql",
      ["admin_list_players", "admin_get_player"]
    ],
    [
      "20261011000003_account_deletion_server.sql",
      ["admin_search_reports", "admin_search_card_reports"]
    ]
  ];
  for (const [file, names] of definitions) {
    for (const name of names) {
      const expression = new RegExp(
        "create or replace function public\\." +
          name +
          "\\([\\s\\S]*?end; \\$\\$;"
      );
      const previous = read("supabase/migrations/" + file).match(
        expression
      )?.[0];
      assert.ok(previous, name);
      const expected = previous
        .replaceAll("'Joueur supprimé'", "'Deleted player'")
        .replaceAll("'Carte supprimée'", "'Deleted card'")
        .replaceAll("'Joueur'", "'Player'");
      assert.equal(
        migration.match(expression)?.[0],
        expected,
        name + " preserves authorization, search and payload structure"
      );
    }
  }
  assert.doesNotMatch(
    migration,
    /'Joueur'|'Joueur supprimé'|'Carte supprimée'|grant |revoke /i
  );
  assert.match(migration, /begin;[\s\S]*commit;/);
});
