import { normalizeWhitespace } from "./helpers/normalize-whitespace.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("l'administration repose sur un rôle serveur et une fonction limitée à l'utilisateur courant", async () => {
  const migration = await read(
    "supabase/migrations/20261003000000_admin_card_management.sql"
  );
  assert.match(migration, /create table public\.admin_users/i);
  assert.match(migration, /enable row level security/i);
  assert.match(
    migration,
    /revoke all on table public\.admin_users[\s\S]+authenticated/i
  );
  assert.match(migration, /auth\.uid\(\)[\s\S]+public\.admin_users/i);
  assert.match(
    migration,
    /grant execute on function public\.is_current_user_admin\(\) to authenticated/i
  );
});

test("chaque mutation de carte réautorise l'admin côté serveur et journalise l'action", async () => {
  const actions = await read("app/admin/cards/actions.ts");
  for (const name of [
    "createCardAction",
    "importCardsAction",
    "updateCardAction",
    "deleteCardAction"
  ]) {
    const start = actions.indexOf(`function ${name}`);
    assert.notEqual(start, -1, `${name} absente`);
    const next = actions.indexOf("export async function", start + 20);
    const body = actions.slice(start, next === -1 ? undefined : next);
    assert.match(
      body,
      /requireAdminAction\(\)/,
      `${name} doit revérifier le rôle`
    );
  }
  assert.match(actions, /admin_audit_logs/g);
});

test("l'application admin utilise la session authentifiée sans clé service-role", async () => {
  const actions = await read("app/admin/cards/actions.ts");
  const page = await read("app/admin/cards/page.tsx");
  const ui = await read("app/admin/cards/admin-card-manager.tsx");
  assert.doesNotMatch(
    actions + page + ui,
    /SERVICE_ROLE|SECRET_KEY|createAdminClient/
  );
  const migration = await read(
    "supabase/migrations/20261003000000_admin_card_management.sql"
  );
  assert.match(migration, /cards_admin_update/);
  assert.match(migration, /card_images_admin_insert/);
});

test("un CSV admin sans source_id bascule en source manuelle pour obtenir un identifiant stable", async () => {
  const actions = await read("app/admin/cards/actions.ts");
  assert.match(
    normalizeWhitespace(actions),
    normalizeWhitespace(
      /source:\s*sourceId\s*\?\s*\(?row\.source \|\| "manual"\)?\s*:\s*"manual"/
    )
  );
  assert.match(
    normalizeWhitespace(actions),
    normalizeWhitespace(/normalize\("NFD"\)/)
  );
  assert.match(
    normalizeWhitespace(actions),
    normalizeWhitespace(
      /row\.nom \?\? row\.name \?\? row\.personnage \?\? row\.character/
    )
  );
  assert.match(
    normalizeWhitespace(actions),
    normalizeWhitespace(/row\.franchise \?\? row\.licence/)
  );
  assert.match(actions, /imageUrlFromCsvRow\(row\)/);
  assert.match(
    normalizeWhitespace(actions),
    normalizeWhitespace(/\.replace\(\/\^http:/)
  );
  assert.match(
    normalizeWhitespace(actions),
    normalizeWhitespace(/deriveSourceId\(card\)/)
  );
  assert.match(
    normalizeWhitespace(actions),
    normalizeWhitespace(/relax_column_count: true/)
  );
});

test("les erreurs d'import CSV affichent le nom de la carte avec sa ligne", async () => {
  const actions = await read("app/admin/cards/actions.ts");
  const importStart = actions.indexOf("function importCardsAction");
  const updateStart = actions.indexOf("function updateCardAction");
  const csvImport = actions.slice(importStart, updateStart);
  assert.match(csvImport, /rows\[failure\.record - 1\]\?\.nom\.trim\(\)/);
  assert.match(csvImport, /Card “\$\{cardName\}”/);
  assert.match(
    csvImport,
    /\(row \$\{failure\.record\}\): \$\{failure\.message\}/
  );
  assert.match(csvImport, /Unnamed card/);
});

test("l'import CSV admin accepte jusqu'à 500 cartes", async () => {
  const actions = await read("app/admin/cards/actions.ts");
  const ui = await read("app/admin/cards/admin-card-manager.tsx");
  assert.match(actions, /records\.length > 500/);
  assert.match(actions, /Maximum 500 cards per import\./);
  assert.match(ui, /Up to 500 rows\./);
});

test("le menu Admin dépend du rôle et Succès reste dans le menu profil", async () => {
  const topbar = await read("components/topbar.tsx");
  const adminLink = topbar.indexOf('href="/admin/cards"');
  const achievementsLink = topbar.indexOf('href="/achievements"');
  assert.ok(adminLink > 0 && achievementsLink > adminLink);
  assert.equal((topbar.match(/href="\/achievements"/g) ?? []).length, 1);
  assert.match(topbar.slice(adminLink - 100, adminLink), /isAdmin/);
  const hook = await read("hooks/use-is-admin.ts");
  assert.match(hook, /rpc\("is_current_user_admin"\)/);
});

test("une carte existante accepte une nouvelle image par URL ou fichier", async () => {
  const actions = await read("app/admin/cards/actions.ts");
  const ui = await read("app/admin/cards/admin-card-manager.tsx");
  const updateStart = actions.indexOf("function updateCardAction");
  const deleteStart = actions.indexOf("function deleteCardAction");
  const update = actions.slice(updateStart, deleteStart);
  assert.match(
    normalizeWhitespace(update),
    normalizeWhitespace(/form\.get\("image_file"\)/)
  );
  assert.match(
    normalizeWhitespace(update),
    normalizeWhitespace(/imageForCard\(form, imageCard\)/)
  );
  assert.match(
    normalizeWhitespace(update),
    normalizeWhitespace(/patch\.image_url/)
  );
  assert.match(normalizeWhitespace(ui), normalizeWhitespace(/New image URL/));
  assert.match(normalizeWhitespace(ui), normalizeWhitespace(/new file/));
  assert.doesNotMatch(normalizeWhitespace(ui), normalizeWhitespace(/>Saga</));
  assert.match(ui, /Choose a category/);
  assert.match(ui, /\+ New category…/);
  assert.match(ui, /New category name/);
});

test("le remplacement d'une image admin utilise une nouvelle URL pour contourner les caches", async () => {
  const actions = await read("app/admin/cards/actions.ts");
  const updateStart = actions.indexOf("function updateCardAction");
  const deleteStart = actions.indexOf("function deleteCardAction");
  const update = actions.slice(updateStart, deleteStart);
  assert.match(
    normalizeWhitespace(actions),
    normalizeWhitespace(/import \{ randomUUID \} from "node:crypto"/)
  );
  assert.match(
    normalizeWhitespace(update),
    normalizeWhitespace(/`\$\{imagePath\(imageCard\)\}-\$\{randomUUID\(\)\}`/)
  );
  assert.match(
    normalizeWhitespace(update),
    normalizeWhitespace(
      /patch\.image_url = client\.storage\.from\("card-images"\)\.getPublicUrl\(path\)\.data\.publicUrl/
    )
  );
});

test("la suppression admin demande une confirmation explicite", async () => {
  const ui = await read("app/admin/cards/admin-card-manager.tsx");
  assert.match(
    normalizeWhitespace(ui),
    normalizeWhitespace(
      /const \[deleteConfirm, setDeleteConfirm\] = useState\(false\)/
    )
  );
  assert.match(
    normalizeWhitespace(ui),
    normalizeWhitespace(
      /type="button" onClick=\{\(\)=>setDeleteConfirm\(true\)\}>Delete/
    )
  );
  assert.match(
    normalizeWhitespace(ui),
    normalizeWhitespace(
      /<Modal open=\{deleteConfirm\}[\s\S]*?title="Delete this card\?"/
    )
  );
  assert.match(
    normalizeWhitespace(ui),
    normalizeWhitespace(/This action is irreversible\./)
  );
  assert.match(ui, /All owned copies will be removed/);
  assert.match(ui, /the leading bid refunded/);
  assert.match(
    normalizeWhitespace(ui),
    normalizeWhitespace(/<form action=\{deleteAction\}[^>]+>/)
  );
  assert.match(
    normalizeWhitespace(ui),
    normalizeWhitespace(
      /type="submit">\{deleting \? "Deleting…" : "Confirm deletion"\}/
    )
  );
});

test("un admin peut supprimer une carte possédée et nettoyer ses usages", async () => {
  const actions = await read("app/admin/cards/actions.ts");
  const migration = await read(
    "supabase/migrations/20261011000001_admin_delete_owned_card.sql"
  );
  const deleteStart = actions.indexOf("function deleteCardAction");
  const deletion = actions.slice(deleteStart);

  assert.match(deletion, /requireAdminAction\(\)/);
  assert.match(deletion, /rpc\(\s*"admin_delete_card"/);
  assert.doesNotMatch(deletion, /Suppression refusée/);
  assert.match(
    migration,
    /create or replace function public\.admin_delete_card/
  );
  assert.match(migration, /if not public\.is_current_user_admin\(\)/);
  assert.match(
    migration,
    /update public\.trade_offers[\s\S]+status = 'declined'/
  );
  assert.match(
    migration,
    /perform public\.credit_karas\(sale\.buyer_id, sale\.current_price\)/
  );
  assert.match(migration, /delete from public\.auctions where id = sale\.id/);
  assert.match(migration, /set kept_choice_id = null/);
  assert.match(migration, /delete from public\.card_shares/);
  assert.match(migration, /delete from public\.decision_pack_choices/);
  assert.match(
    migration,
    /delete from public\.user_cards where card_id = p_card_id/
  );
  assert.match(migration, /delete from public\.cards where id = p_card_id/);
  assert.match(migration, /'card\.delete'/);
  assert.match(
    migration,
    /grant execute on function public\.admin_delete_card\(uuid\) to authenticated/
  );
});

test("la licence est facultative lors de l’ajout et de la modification d’une carte", async () => {
  const actions = await read("app/admin/cards/actions.ts");
  const ui = await read("app/admin/cards/admin-card-manager.tsx");
  assert.doesNotMatch(ui, /name="franchise" required/);
  assert.match(ui, /Primary license/);
  assert.match(actions, /if \(!patch\.nom \|\| !patch\.categorie\)/);
  assert.doesNotMatch(actions, /!patch\.franchise/);
});

test("la resynchronisation admin peut cibler les catégories existantes", async () => {
  const migration = await read(
    "supabase/migrations/20261003000004_admin_card_categories_select.sql"
  );
  assert.match(
    migration,
    /grant select on table public\.card_categories to authenticated/i
  );
  const adminMigration = await read(
    "supabase/migrations/20261003000000_admin_card_management.sql"
  );
  assert.match(
    adminMigration,
    /card_categories_admin_all[\s\S]+is_current_user_admin/i
  );
});

test("un remplacement d’image admin peut relire l’objet nécessaire à l’upsert", async () => {
  const migration = await read(
    "supabase/migrations/20261003000005_admin_card_images_select.sql"
  );
  assert.match(migration, /create policy card_images_admin_select/i);
  assert.match(migration, /on storage\.objects for select to authenticated/i);
  assert.match(
    migration,
    /bucket_id = 'card-images'[\s\S]+is_current_user_admin/i
  );
});

test("un admin peut rechercher une carte par son nom dans tout le catalogue", async () => {
  const page = await read("app/admin/cards/page.tsx");
  assert.match(
    page,
    /searchParams:\s*Promise<\{ q\?: string; category\?: string \}>/
  );
  assert.match(page, /nom\.ilike\.\$\{term\},franchise\.ilike\.\$\{term\}/);
  assert.match(page, /name="q"/);
  assert.match(page, /Search catalogue cards/);
});

test("la recherche admin retourne toutes les cartes d'une licence", async () => {
  const page = await read("app/admin/cards/page.tsx");
  const manager = await read("app/admin/cards/admin-card-manager.tsx");
  assert.match(page, /franchise\.ilike\.\$\{term\}/);
  assert.match(page, /ADMIN_SEARCH_PAGE_SIZE = 1000/);
  assert.match(page, /offset \+= ADMIN_SEARCH_PAGE_SIZE/);
  assert.match(page, /Card or license name/);
  assert.match(page, /V Cyberpunk/);
  assert.match(manager, /this name or license/);
});

test("la liste admin limite les formulaires hydrates et se pagine localement", async () => {
  const manager = await read("app/admin/cards/admin-card-manager.tsx");
  assert.match(manager, /const ADMIN_CARDS_PER_PAGE = 20/);
  assert.match(manager, /const visibleCards = cards\.slice\(/);
  assert.match(manager, /visibleCards\.map\(card =>/);
  assert.match(manager, /editingCardId === card\.id/);
  assert.match(
    manager,
    /<Pagination\s+page=\{safePage\}\s+pageCount=\{pageCount\}/
  );
  assert.doesNotMatch(manager, /\{cards\.map\(card =>\s*\(\s*<CardRow/);
});

test("la recherche admin combine le personnage et sa licence", async () => {
  const page = await read("app/admin/cards/page.tsx");
  assert.match(page, /searchQuery\.split\(\/\\s\+\/\)\.filter\(Boolean\)/);
  assert.match(page, /for \(const searchTerm of searchTerms\)/);
  assert.match(page, /const term = quotedLike\(searchTerm\)/);
  assert.match(
    page,
    /cardsQuery = cardsQuery\.or\(`nom\.ilike\.\$\{term\},franchise\.ilike\.\$\{term\}`\)/
  );
});

test("un admin peut filtrer les cartes avec une liste de catégories", async () => {
  const page = await read("app/admin/cards/page.tsx");
  const migration = await read(
    "supabase/migrations/20261003000006_admin_card_category_filter.sql"
  );
  assert.match(
    normalizeWhitespace(page),
    normalizeWhitespace(
      /searchParams:\s*Promise<\{ q\?: string; category\?: string \}>/
    )
  );
  assert.match(
    normalizeWhitespace(page),
    normalizeWhitespace(/rpc\("list_admin_card_categories"\)/)
  );
  assert.match(
    normalizeWhitespace(page),
    normalizeWhitespace(/name="category"/)
  );
  assert.match(
    normalizeWhitespace(page),
    normalizeWhitespace(/All categories/)
  );
  assert.match(
    normalizeWhitespace(page),
    normalizeWhitespace(
      /sm:grid-cols-\[minmax\(0,3fr\)_minmax\(14rem,2fr\)_auto_auto\]/
    )
  );
  assert.match(
    normalizeWhitespace(page),
    normalizeWhitespace(/id="admin-card-category"[^>]+w-full min-w-0/)
  );
  assert.match(
    normalizeWhitespace(page),
    normalizeWhitespace(/aria-label="Card or license name"[^>]+w-full min-w-0/)
  );
  assert.match(
    normalizeWhitespace(page),
    normalizeWhitespace(/cardsQuery\.eq\("categorie", selectedCategory\)/)
  );
  assert.doesNotMatch(
    normalizeWhitespace(page),
    normalizeWhitespace(/name="q"[^>]+required/)
  );
  assert.match(
    normalizeWhitespace(migration),
    normalizeWhitespace(/select distinct categorie as category/i)
  );
  assert.match(
    normalizeWhitespace(migration),
    normalizeWhitespace(/if not public\.is_current_user_admin\(\)/i)
  );
});

test("la migration NBA range les cartes dans SPORT avec la licence NBA", async () => {
  const migration = await read(
    "supabase/migrations/20261004000000_migrate_nba_cards_to_sport.sql"
  );
  const nbaCsv = await read("data/nba_clean.csv");

  assert.match(migration, /upper\(btrim\(categorie\)\) = 'NBA'/i);
  assert.match(migration, /set categorie = 'SPORT',[\s\S]+franchise = 'NBA'/i);
  assert.match(
    migration,
    /insert into public\.card_categories[\s\S]+select card_id, 'SPORT'/i
  );
  assert.match(
    migration,
    /delete from public\.card_categories[\s\S]+upper\(btrim\(categorie\)\) = 'NBA'/i
  );
  assert.doesNotMatch(nbaCsv, /^,[^,\r\n]+,NBA,/m);
  assert.match(nbaCsv, /,SPORT,NBA,,/);

  const db = new PGlite();
  await db.exec(`
    create schema if not exists public;
    create table public.cards (id uuid primary key, categorie text not null, franchise text);
    create table public.card_categories (
      card_id uuid not null references public.cards(id) on delete cascade,
      categorie text not null,
      primary key (card_id, categorie)
    );
    insert into public.cards (id, categorie, franchise) values
      ('00000000-0000-0000-0000-000000000001', ' NBA ', null),
      ('00000000-0000-0000-0000-000000000002', 'AUTRE', 'Ancienne licence'),
      ('00000000-0000-0000-0000-000000000003', 'MUSIQUE', null);
    insert into public.card_categories (card_id, categorie) values
      ('00000000-0000-0000-0000-000000000001', 'NBA'),
      ('00000000-0000-0000-0000-000000000001', 'SPORT'),
      ('00000000-0000-0000-0000-000000000002', 'nba'),
      ('00000000-0000-0000-0000-000000000003', 'MUSIQUE');
  `);
  await db.exec(migration);

  const cards = await db.query(
    "select id, categorie, franchise from public.cards order by id"
  );
  assert.deepEqual(cards.rows, [
    {
      id: "00000000-0000-0000-0000-000000000001",
      categorie: "SPORT",
      franchise: "NBA"
    },
    {
      id: "00000000-0000-0000-0000-000000000002",
      categorie: "SPORT",
      franchise: "NBA"
    },
    {
      id: "00000000-0000-0000-0000-000000000003",
      categorie: "MUSIQUE",
      franchise: null
    }
  ]);
  const categories = await db.query(
    "select card_id, categorie from public.card_categories order by card_id, categorie"
  );
  assert.deepEqual(categories.rows, [
    { card_id: "00000000-0000-0000-0000-000000000001", categorie: "SPORT" },
    { card_id: "00000000-0000-0000-0000-000000000002", categorie: "SPORT" },
    { card_id: "00000000-0000-0000-0000-000000000003", categorie: "MUSIQUE" }
  ]);
  await db.close();
});

test("les catégories existantes et futures sont normalisées en majuscules", async () => {
  const migration = await read(
    "supabase/migrations/20261004000001_uppercase_card_categories.sql"
  );
  const db = new PGlite();
  await db.exec(`
    create schema if not exists public;
    create table public.cards (id uuid primary key, categorie text not null, franchise text);
    create table public.card_categories (
      card_id uuid not null references public.cards(id) on delete cascade,
      categorie text not null,
      primary key (card_id, categorie)
    );
    insert into public.cards (id, categorie) values
      ('00000000-0000-0000-0000-000000000001', 'Anime/Manga'),
      ('00000000-0000-0000-0000-000000000002', ' sport ');
    insert into public.card_categories (card_id, categorie) values
      ('00000000-0000-0000-0000-000000000001', 'Anime/Manga'),
      ('00000000-0000-0000-0000-000000000001', 'ANIME/MANGA'),
      ('00000000-0000-0000-0000-000000000002', ' sport ');
  `);
  await db.exec(migration);

  assert.deepEqual(
    (await db.query("select categorie from public.cards order by id")).rows,
    [{ categorie: "ANIME/MANGA" }, { categorie: "SPORT" }]
  );
  assert.deepEqual(
    (
      await db.query(
        "select card_id, categorie from public.card_categories order by card_id"
      )
    ).rows,
    [
      {
        card_id: "00000000-0000-0000-0000-000000000001",
        categorie: "ANIME/MANGA"
      },
      { card_id: "00000000-0000-0000-0000-000000000002", categorie: "SPORT" }
    ]
  );

  await db.exec(`
    insert into public.cards (id, categorie) values
      ('00000000-0000-0000-0000-000000000003', ' nouvelle catégorie ');
    insert into public.card_categories (card_id, categorie) values
      ('00000000-0000-0000-0000-000000000003', ' nouvelle catégorie ');
  `);
  assert.deepEqual(
    (
      await db.query(
        "select categorie from public.cards where id='00000000-0000-0000-0000-000000000003'"
      )
    ).rows,
    [{ categorie: "NOUVELLE CATÉGORIE" }]
  );
  assert.deepEqual(
    (
      await db.query(
        "select categorie from public.card_categories where card_id='00000000-0000-0000-0000-000000000003'"
      )
    ).rows,
    [{ categorie: "NOUVELLE CATÉGORIE" }]
  );
  await db.close();
});

test("la catégorie ARTISTE est renommée ARTIST et reste normalisée à l'import", async () => {
  const uppercaseMigration = await read(
    "supabase/migrations/20261004000001_uppercase_card_categories.sql"
  );
  const artistMigration = await read(
    "supabase/migrations/20261004000002_rename_artiste_category.sql"
  );
  const db = new PGlite();
  await db.exec(`
    create schema if not exists public;
    create table public.cards (id uuid primary key, categorie text not null, franchise text);
    create table public.card_categories (
      card_id uuid not null references public.cards(id) on delete cascade,
      categorie text not null,
      primary key (card_id, categorie)
    );
    insert into public.cards (id, categorie) values
      ('00000000-0000-0000-0000-000000000001', 'Artiste');
    insert into public.card_categories (card_id, categorie) values
      ('00000000-0000-0000-0000-000000000001', 'Artiste');
  `);
  await db.exec(uppercaseMigration);
  await db.exec(artistMigration);

  assert.deepEqual(
    (await db.query("select categorie from public.cards order by id")).rows,
    [{ categorie: "ARTIST" }]
  );
  assert.deepEqual(
    (
      await db.query(
        "select categorie from public.card_categories order by card_id"
      )
    ).rows,
    [{ categorie: "ARTIST" }]
  );

  await db.exec(`
    insert into public.cards (id, categorie) values
      ('00000000-0000-0000-0000-000000000002', ' artiste ');
  `);
  assert.deepEqual(
    (
      await db.query(
        "select categorie from public.cards where id='00000000-0000-0000-0000-000000000002'"
      )
    ).rows,
    [{ categorie: "ARTIST" }]
  );
  await db.close();
});

test("la catégorie VIDEO GAME est renommée VIDEO GAMES et reste normalisée à l'import", async () => {
  const migration = await read(
    "supabase/migrations/20261004000006_rename_video_games_category.sql"
  );
  assert.match(migration, /select card_id, 'VIDEO GAMES'/i);
  assert.match(migration, /where upper\(btrim\(categorie\)\) = 'VIDEO GAME'/i);
  assert.match(migration, /set categorie = 'VIDEO GAMES'/i);
  assert.match(migration, /when 'VIDEO GAME' then 'VIDEO GAMES'/i);
});

test("les noms de cartes existants et futurs sont normalisés en majuscules", async () => {
  const migration = await read(
    "supabase/migrations/20261004000003_uppercase_card_names.sql"
  );
  const db = new PGlite();
  await db.exec(`
    create schema if not exists public;
    create table public.cards (
      id uuid primary key,
      nom text not null,
      source text not null,
      source_id text not null,
      unique (source, source_id)
    );
    insert into public.cards (id, nom, source, source_id) values
      ('00000000-0000-0000-0000-000000000001', 'Satoru Gojō', 'test', '1'),
      ('00000000-0000-0000-0000-000000000002', ' déjà en MAJUSCULE ', 'test', '2');
  `);
  await db.exec(migration);

  assert.deepEqual(
    (await db.query("select nom from public.cards order by id")).rows,
    [{ nom: "SATORU GOJŌ" }, { nom: "DÉJÀ EN MAJUSCULE" }]
  );

  await db.exec(`
    insert into public.cards (id, nom, source, source_id) values
      ('00000000-0000-0000-0000-000000000003', ' nouvelle carte ', 'test', '3');
    update public.cards set nom = 'nom modifié' where id = '00000000-0000-0000-0000-000000000003';
  `);
  assert.deepEqual(
    (
      await db.query(
        "select nom from public.cards where id='00000000-0000-0000-0000-000000000003'"
      )
    ).rows,
    [{ nom: "NOM MODIFIÉ" }]
  );
  await db.close();
});

test("la migration supprime uniquement DJ CONDOR et toutes ses copies", async () => {
  const migration = await read(
    "supabase/migrations/20261004000004_remove_dj_condor.sql"
  );
  assert.match(migration, /nom = 'DJ CONDOR'/);
  assert.match(migration, /id = '7681348b-0143-4079-86f0-3626dda7cc21'/);
  assert.match(migration, /source_id = '41782'/);
  assert.match(migration, /if matching_cards <> 1 then/);
  assert.match(
    migration,
    /delete from public\.user_cards where card_id = target_id/
  );
  assert.match(migration, /delete from public\.cards where id = target_id/);
  assert.match(migration, /if linked_auctions <> 0 then/);
});

test("la migration supprime uniquement HAE-IN CHA SR et son exemplaire", async () => {
  const migration = await read(
    "supabase/migrations/20261008000003_remove_hae_in_cha_sr.sql"
  );
  assert.match(migration, /id = target_id/);
  assert.match(migration, /nom = 'HAE-IN CHA'/);
  assert.match(migration, /franchise = 'Solo Leveling'/);
  assert.match(migration, /rarete_base = 'SR'/);
  assert.match(migration, /source_id = '138789'/);
  assert.match(
    migration,
    /delete from public\.user_cards where card_id = target_id/
  );
  assert.match(migration, /delete from public\.cards where id = target_id/);
  assert.match(migration, /if linked_auctions <> 0 then/);
  assert.match(migration, /if pending_trades <> 0 then/);
});

test("la migration supprime la licence PERSONA5 the Animation et ses exemplaires", async () => {
  const migration = await read(
    "supabase/migrations/20261009000009_remove_persona5_animation_cards.sql"
  );
  assert.match(
    migration,
    /lower\(btrim\(franchise\)\) = lower\('PERSONA5 the Animation'\)/
  );
  assert.match(migration, /delete from public\.card_shares/);
  assert.match(migration, /delete from public\.decision_pack_choices/);
  assert.match(migration, /update public\.user_cards\s+set is_locked = false/);
  assert.match(
    migration,
    /delete from public\.user_cards\s+where card_id = any\(target_card_ids\)/
  );
  assert.match(
    migration,
    /delete from public\.cards\s+where id = any\(target_card_ids\)/
  );
  assert.match(migration, /if linked_auctions <> 0 then/);
  assert.match(migration, /if pending_trades <> 0 then/);
});

test("la migration supprime Pokémon: The First Movie et rembourse toute mise active", async () => {
  const migration = await read(
    "supabase/migrations/20261009000010_remove_pokemon_first_movie_cards.sql"
  );
  assert.match(migration, /franchise = U&'Pok\\00E9mon: The First Movie'/);
  assert.match(
    migration,
    /where status = 'active'[\s\S]+card_instance_id = any\(target_instance_ids\)/
  );
  assert.match(
    migration,
    /perform public\.credit_karas\(sale\.buyer_id, sale\.current_price\)/
  );
  assert.match(migration, /delete from public\.auctions\s+where id = sale\.id/);
  assert.match(migration, /update public\.user_cards\s+set is_locked = false/);
  assert.match(
    migration,
    /delete from public\.user_cards\s+where card_id = any\(target_card_ids\)/
  );
  assert.match(
    migration,
    /delete from public\.cards\s+where id = any\(target_card_ids\)/
  );
  assert.match(migration, /if pending_trades <> 0 then/);
});

test("la migration supprime Kirby: Right Back at Ya! et ses exemplaires", async () => {
  const migration = await read(
    "supabase/migrations/20261009000011_remove_kirby_right_back_cards.sql"
  );
  assert.match(migration, /franchise = 'Kirby: Right Back at Ya!'/);
  assert.match(
    migration,
    /perform public\.credit_karas\(sale\.buyer_id, sale\.current_price\)/
  );
  assert.match(migration, /delete from public\.auctions\s+where id = sale\.id/);
  assert.match(migration, /delete from public\.card_shares/);
  assert.match(migration, /delete from public\.decision_pack_choices/);
  assert.match(migration, /update public\.user_cards\s+set is_locked = false/);
  assert.match(
    migration,
    /delete from public\.user_cards\s+where card_id = any\(target_card_ids\)/
  );
  assert.match(
    migration,
    /delete from public\.cards\s+where id = any\(target_card_ids\)/
  );
  assert.match(migration, /if pending_trades <> 0 then/);
});

test("la migration supprime NieR:Automata Ver1.1a Cour 2 et ses exemplaires", async () => {
  const migration = await read(
    "supabase/migrations/20261009000013_remove_nier_automata_cour_2_cards.sql"
  );
  assert.match(migration, /franchise = 'NieR:Automata Ver1.1a Cour 2'/);
  assert.match(
    migration,
    /perform public\.credit_karas\(sale\.buyer_id, sale\.current_price\)/
  );
  assert.match(migration, /delete from public\.auctions\s+where id = sale\.id/);
  assert.match(migration, /delete from public\.card_shares/);
  assert.match(migration, /delete from public\.decision_pack_choices/);
  assert.match(migration, /update public\.user_cards\s+set is_locked = false/);
  assert.match(
    migration,
    /delete from public\.user_cards\s+where card_id = any\(target_card_ids\)/
  );
  assert.match(
    migration,
    /delete from public\.cards\s+where id = any\(target_card_ids\)/
  );
  assert.match(migration, /if pending_trades <> 0 then/);
});

test("la migration supprime uniquement les cinq licences Persona demandées", async () => {
  const migration = await read(
    "supabase/migrations/20261009000014_remove_persona_franchise_cards.sql"
  );
  for (const franchise of [
    "Persona 3 the Movie: #1 Spring of Birth",
    "Persona 3 the Movie: #2 Midsummer Knight''s Dream",
    "Persona 4 the Animation",
    "Persona4 the Golden ANIMATION",
    "Persona -trinity soul-"
  ])
    assert.match(
      migration,
      new RegExp(franchise.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
  assert.doesNotMatch(migration, /Persona 3 the Movie: #3 Falling Down/);
  assert.match(
    migration,
    /perform public\.credit_karas\(sale\.buyer_id, sale\.current_price\)/
  );
  assert.match(migration, /update public\.user_cards\s+set is_locked = false/);
  assert.match(
    migration,
    /delete from public\.user_cards\s+where card_id = any\(target_card_ids\)/
  );
  assert.match(
    migration,
    /delete from public\.cards\s+where id = any\(target_card_ids\)/
  );
  assert.match(migration, /if pending_trades <> 0 then/);
});

test("la migration Kingdom conserve l'import manuel et supprime les copies des imports doublons", async () => {
  const migration = await read(
    "supabase/migrations/20261007000004_remove_kingdom_duplicate_imports.sql"
  );
  assert.match(migration, /franchise = 'Kingdom Season 2'/);
  assert.match(migration, /franchise = 'Kingdom' and source = 'anilist'/);
  assert.doesNotMatch(migration, /franchise = 'Kingdom'\s*\)/);
  assert.match(
    migration,
    /delete from public\.user_cards\s+where card_id = any\(target_card_ids\)/
  );
  assert.match(
    migration,
    /delete from public\.cards\s+where id = any\(target_card_ids\)/
  );
  assert.match(migration, /if linked_auctions <> 0 then/);
  assert.match(migration, /if pending_trades <> 0 then/);
});

test("la migration Dragon Ball retire les doublons manuels et traduit les noms japonais", async () => {
  const migration = await read(
    "supabase/migrations/20261007000005_remove_dragon_ball_manual_duplicates.sql"
  );
  assert.match(migration, /source = 'anilist'/);
  for (const sourceId of ["2147", "4318", "2093", "2104", "2551"]) {
    assert.match(migration, new RegExp(`['"]${sourceId}['"]`));
  }
  assert.doesNotMatch(migration, /source_id\s*=\s*'2707'/);
  assert.match(
    migration,
    /delete from public\.user_cards\s+where card_id = any\(target_card_ids\)/
  );
  assert.match(
    migration,
    /delete from public\.cards\s+where id = any\(target_card_ids\)/
  );
  assert.match(
    migration,
    /set franchise = 'Dragon Ball'\s+where franchise = 'Dragon Ball Z'/
  );
  assert.doesNotMatch(migration, /where franchise like 'Dragon Ball Z%'/);
  assert.match(migration, /when '2150' then 'C-13'/);
  assert.match(migration, /when '2149' then 'C-14'/);
  assert.match(migration, /when '2148' then 'C-15'/);
  assert.match(
    migration,
    /where franchise = 'Dragon Ball Z: Super Android 13!'/
  );
  assert.match(migration, /set nom = 'C-19'/);
  assert.match(migration, /source_id = '6115'/);
  assert.match(migration, /when '2099' then 'C-16'/);
  assert.match(migration, /when '2098' then 'C-8'/);
  assert.match(migration, /when '2159' then 'KRILIN'/);
  assert.match(migration, /when '3694' then 'FREEZER'/);
  assert.match(migration, /when '6167' then U&'TORTUE G\\00C9NIALE'/);
  assert.match(migration, /when '6127' then 'SHENRON'/);
  assert.match(migration, /when '21344' then 'ROI NIKOCHAN'/);
  assert.match(migration, /when '332776' then 'MEMBRE DU GANG DES LAPINS'/);
});

test("la migration supprime uniquement les quatre licences demandées et nettoie leurs usages", async () => {
  const migration = await read(
    "supabase/migrations/20261013000000_remove_requested_pokemon_and_ffvii_licenses.sql"
  );
  for (const franchise of [
    "Pok\\00E9mon 3: The Movie",
    "Pok\\00E9mon Horizons: The Series",
    "Pok\\00E9mon the Series: Ruby and Sapphire",
    "Final Fantasy VII: Advent Children"
  ]) {
    assert.match(
      migration,
      new RegExp(franchise.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    );
  }
  assert.doesNotMatch(migration, /Pok\\00E9mon: The First Movie/);
  assert.match(migration, /set status = 'declined'/);
  assert.match(
    migration,
    /perform public\.credit_karas\(sale\.buyer_id, sale\.current_price\)/
  );
  assert.match(
    migration,
    /update public\.decision_packs[\s\S]+set kept_choice_id = null/
  );
  assert.match(migration, /delete from public\.card_shares/);
  assert.match(migration, /delete from public\.decision_pack_choices/);
  assert.match(migration, /update public\.user_cards\s+set is_locked = false/);
  assert.match(
    migration,
    /delete from public\.user_cards\s+where card_id = any\(target_card_ids\)/
  );
  assert.match(
    migration,
    /delete from public\.cards\s+where id = any\(target_card_ids\)/
  );
});

test("une carte admin accepte plusieurs licences et conserve la premiere comme licence visible", async () => {
  const actions = await read("app/admin/cards/actions.ts");
  const page = await read("app/admin/cards/page.tsx");
  const ui = await read("app/admin/cards/admin-card-manager.tsx");
  const migration = await read(
    "supabase/migrations/20261013000003_multiple_card_franchises.sql"
  );

  assert.match(actions, /form\.getAll\("franchise"\)/);
  assert.match(actions, /franchise: franchises\[0\] \?\? ""/);
  assert.match(actions, /from\("card_franchises"\)/);
  assert.match(actions, /franchises\.map\(\(franchise, position\)/);
  assert.match(ui, /\+ Secondary license/);
  assert.match(ui, /Secondary license \$\{index\}/);
  assert.match(ui, /Each license adds the card to the corresponding Binder/);
  assert.match(page, /card_franchises\(franchise,position\)/);
  assert.match(
    page,
    /\.sort\(\(left, right\) => left\.position - right\.position\)/
  );
  assert.match(migration, /create table public\.card_franchises/i);
  assert.match(migration, /references public\.cards\(id\) on delete cascade/i);
});

test("une carte ARTIST conserve ses licences explicites", async t => {
  // Walid approved replacing the former ARTIST fallback assertion with real NULL writes.
  const { assertAdminEmptyLicense } =
    await import("./helpers/optional-card-franchise.mjs");
  await assertAdminEmptyLicense(t);
});

test("la migration supprime uniquement Devil May Cry de la categorie ANIME/MANGA", async () => {
  const migration = await read(
    "supabase/migrations/20261013000002_remove_devil_may_cry_anime_cards.sql"
  );
  assert.match(
    migration,
    /lower\(btrim\(franchise\)\) = lower\('Devil May Cry'\)/
  );
  assert.match(migration, /upper\(btrim\(categorie\)\) = 'ANIME\/MANGA'/);
  assert.match(migration, /set status = 'declined'/);
  assert.match(
    migration,
    /perform public\.credit_karas\(sale\.buyer_id, sale\.current_price\)/
  );
  assert.match(migration, /delete from public\.card_shares/);
  assert.match(migration, /delete from public\.decision_pack_choices/);
  assert.match(
    migration,
    /delete from public\.user_cards\s+where card_id = any\(target_card_ids\)/
  );
  assert.match(
    migration,
    /delete from public\.cards\s+where id = any\(target_card_ids\)/
  );
});

test("la suppression groupée est réservée aux admins, plafonnée et réutilise la RPC individuelle", async () => {
  const actions = await read("app/admin/cards/actions.ts");
  const shared = await read("app/admin/cards/bulk-delete.ts");
  const migration = await read(
    "supabase/migrations/20261015000004_admin_bulk_delete_cards.sql"
  );
  for (const name of ["previewDeleteCardsAction", "deleteCardsAction"]) {
    const body = actions.slice(actions.indexOf(`function ${name}`));
    assert.ok(
      body.indexOf("requireAdminAction()") < body.indexOf(".rpc("),
      `${name} doit vérifier l’admin avant la RPC`
    );
  }
  const deletion = actions.slice(actions.indexOf("function deleteCardsAction"));
  assert.match(
    deletion,
    /confirmation\.trim\(\) !== String\(cardIds\.length\)/
  );
  assert.match(deletion, /rpc\("admin_delete_cards"/);

  const limit = Number(shared.match(/MAX_BULK_DELETE_CARDS = (\d+)/)?.[1]);
  assert.equal(
    Number(migration.match(/max_cards constant integer := (\d+)/)?.[1]),
    limit
  );
  assert.equal(limit, 500);
  // Single and bulk deletions share one implementation.
  assert.equal(
    migration.match(/public\.admin_delete_card_core\((p_card_id|target_id)\)/g)
      ?.length,
    2
  );
  assert.match(
    migration,
    /revoke all on function public\.admin_delete_card_core\(uuid\)\nfrom public, anon, authenticated;/
  );
  assert.doesNotMatch(
    migration,
    /grant execute on function public\.admin_delete_card_core/
  );
});

test("l'import CSV sépare plusieurs licences avec « / » sans casser Fate/Zero", async () => {
  const { splitFranchises } = await import("../scripts/import-cards.mjs");
  assert.deepEqual(splitFranchises("One Piece / Naruto /  one piece "), [
    "One Piece",
    "Naruto"
  ]);
  assert.deepEqual(splitFranchises("Fate/Zero / Fate/stay night"), [
    "Fate/Zero",
    "Fate/stay night"
  ]);
  assert.deepEqual(splitFranchises(""), []);
  assert.throws(
    () =>
      splitFranchises(
        Array.from({ length: 11 }, (_, i) => `L${i}`).join(" / ")
      ),
    /Maximum 10 licenses/
  );
  const actions = await read("app/admin/cards/actions.ts");
  assert.match(actions, /syncImportedFranchises\(/);
});
