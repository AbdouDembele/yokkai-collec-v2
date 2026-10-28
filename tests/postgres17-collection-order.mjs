// Required CI job; runs only against a fresh disposable service container, never SSH/prod.
// #388: the collection page RPC sorts names with an ICU collation that must
// match String.localeCompare("en-US", { sensitivity: "base", numeric: true }).
// PGlite has no ICU, so this check runs on the production PostgreSQL image.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { bootstrapSQL } from "../scripts/replay-migrations.mjs";

const container = process.env.TEST_POSTGRES_CONTAINER;
assert.ok(
  container,
  "TEST_POSTGRES_CONTAINER must identify the disposable PostgreSQL 17 service"
);
assert.equal(
  execFileSync(
    "docker",
    ["inspect", "--format", "{{.Config.Image}}", container],
    { encoding: "utf8" }
  ).trim(),
  "supabase/postgres:17.6.1.136"
);
const database = "collection_order_ci";
function query(sql, db = database) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-w",
      "-qAt",
      "-U",
      "supabase_admin",
      "-d",
      db,
      "-v",
      "ON_ERROR_STOP=1"
    ]);
    let out = "",
      err = "";
    child.stdout.on("data", b => (out += b));
    child.stderr.on("data", b => (err += b));
    child.on("close", code =>
      code === 0 ? resolve(out.trim()) : reject(new Error(err.trim()))
    );
    child.stdin.end(sql + "\n");
  });
}

// Roles may already exist when another script used this service first.
await query(
  `do $$ begin
     if not exists(select 1 from pg_roles where rolname='postgres') then create role postgres login nosuperuser bypassrls createrole; end if;
     if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
     if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
     if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
   end $$; create database ${database} owner postgres;`,
  "postgres"
);
await query(`set role postgres; ${bootstrapSQL}`);
const directory = new URL("../supabase/migrations/", import.meta.url);
for (const name of readdirSync(directory)
  .filter(n => n.endsWith(".sql"))
  .sort())
  try {
    await query(
      `set role postgres; ${readFileSync(new URL(name, directory), "utf8")}`
    );
  } catch (error) {
    throw new Error(`Migration ${name}: ${error.message}`, { cause: error });
  }

// The client's own sort and grouping code.
const modules = new Map();
function load(specifier) {
  const file = specifier.replace(/^@\//, "") + ".ts";
  if (modules.has(file)) return modules.get(file);
  const exports = {};
  modules.set(file, exports);
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022
      }
    }).outputText,
    { exports, require: load, Date, Number, Map, Set, Math }
  );
  return exports;
}
const { filterCollection } = load("@/lib/ui/collection-filter");
const { groupCollection } = load("@/lib/ui/collection-groups");

const player = "38840000-0000-4000-8000-000000000001";
// Case, accents, embedded numbers and names equal at the base level.
const names = [
  "Card 10",
  "card 2",
  "Card 2",
  "Éclair",
  "eclair",
  "Zed",
  "Ångström",
  "apple",
  "Item 9",
  "item 10",
  "Œuvre",
  "oeuvre",
  "Ça va",
  "ca va",
  "No. 100",
  "no. 20"
];
const rarities = ["C", "R", "SR", "SSR", "LR"];
let sql = `insert into auth.users(id,raw_user_meta_data) values ('${player}','{"pseudo":"OrderPlayer"}');`;
const client = [];
for (const [i, name] of names.entries()) {
  const card = `38850000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
  const rarity = rarities[i % 5];
  sql += `insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source) values ('${card}','order-${i}',$n$${name}$n$,'Anime',null,'${rarity}','https://example.test/${i}.png','test');`;
  for (let copy = 0; copy < 2; copy++) {
    const id = `38860000-0000-4000-8000-${String(i * 2 + copy + 1).padStart(12, "0")}`;
    const at = new Date(
      Date.parse("2026-10-01T00:00:00Z") + ((i * 7 + copy) % 5) * 1000
    ).toISOString();
    sql += `insert into public.user_cards(id,user_id,card_id,rarity,date_obtention) values ('${id}','${player}','${card}','${rarity}','${at}');`;
    client.push({
      id: card,
      name,
      category: "Anime",
      rarity,
      image: "",
      catalogueImage: "",
      customImageUrl: null,
      instanceId: id,
      obtainedAt: at,
      shiny: false,
      isEvolved: false,
      isFirstOwner: false,
      locked: false,
      folderId: null
    });
  }
}
await query(sql);
const empty = {
  query: "",
  category: [],
  rarity: [],
  shinyOnly: false,
  folder: "",
  auctionOnly: false,
  lockedOnly: false
};
for (const sort of ["name", "rarity", "recent", "oldest"]) {
  const expected = JSON.parse(
    JSON.stringify(
      groupCollection(
        filterCollection(client, { ...empty, sort }, () => false)
      ).map(group => group.key)
    )
  );
  const page = JSON.parse(
    await query(
      `set role authenticated; select set_config('request.jwt.claim.sub','${player}',false) is not null; select public.get_collection_groups_page(p_sort=>'${sort}',p_limit=>60);`
    ).then(out => out.split("\n").at(-1))
  );
  assert.deepEqual(
    page.groups.map(group => group.key),
    expected,
    sort
  );
  console.log(
    `${sort}: ${expected.length} groups in the same order as localeCompare("en-US", base, numeric)`
  );
}
