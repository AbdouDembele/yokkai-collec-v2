import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const context = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(
    readFileSync(
      new URL("../lib/ui/license-progress.ts", import.meta.url),
      "utf8"
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020
      }
    }
  ).outputText,
  context
);
const {
  buildLicenseCatalogueTotals,
  buildLicenseProgress,
  paniniAlbumForCard
} = context.exports;

const card = (instanceId, id, anime, category = "ANIME/MANGA") => ({
  instanceId,
  id,
  anime,
  category
});

test("stable identities keep identical display names separate, preserve secondary binders and deduplicate copies", () => {
  const primary = {
    key: "series:verified",
    name: "Same title",
    origin: "series"
  };
  const secondary = {
    key: "source:secondary",
    name: "Exact secondary",
    origin: "source"
  };
  const protectedBinder = {
    key: "source:protected",
    name: "Same title",
    origin: "source"
  };
  const cards = [
    { ...card("a1", "a", "Source season 2"), binders: [primary, secondary] },
    { ...card("a2", "a", "Source season 2"), binders: [primary, secondary] },
    { ...card("b1", "b", "Same title"), binders: [protectedBinder] }
  ];
  const totals = buildLicenseCatalogueTotals(cards);
  assert.equal(totals.length, 3);
  const progress = buildLicenseProgress(cards, [
    { binderKey: primary.key, license: primary.name, total: 2 },
    { binderKey: protectedBinder.key, license: protectedBinder.name, total: 1 },
    { binderKey: secondary.key, license: secondary.name, total: 4 }
  ]);
  assert.equal(progress.find(r => r.binderKey === primary.key).percent, 50);
  assert.equal(
    progress.find(r => r.binderKey === protectedBinder.key).percent,
    100
  );
  assert.equal(progress.find(r => r.binderKey === secondary.key).owned, 1);
  assert.equal(cards[0].anime, "Source season 2");
});

test("le mode Panini compte les cartes uniques d'une licence", () => {
  const progress = buildLicenseProgress(
    [
      card("a1", "a", "One Piece"),
      card("a2", "a", "One Piece"),
      card("b1", "b", "One Piece")
    ],
    [{ license: "One Piece", total: 4 }]
  );
  assert.equal(progress[0].license, "One Piece");
  assert.equal(progress[0].total, 4);
  assert.equal(progress[0].owned, 2);
  assert.equal(progress[0].percent, 50);
});

test("les licences les plus complètes apparaissent en premier", () => {
  const progress = buildLicenseProgress(
    [card("a", "a", "Alpha")],
    [
      { license: "Beta", total: 2 },
      { license: "Alpha", total: 1 }
    ]
  );
  assert.deepEqual(
    progress.map(item => item.license),
    ["Alpha", "Beta"]
  );
});

test("les catégories éditoriales deviennent des albums Panini uniques", () => {
  const catalogue = [
    card("film-1", "film-1", "Alien", "FILM"),
    card("film-2", "film-2", "Matrix", "FILM"),
    card("brainrot-1", "brainrot-1", "Tung Tung Tung Sahur", "BRAINROT"),
    card("disney-1", "disney-1", "Hannah Montana", "DISNEY CHANNEL"),
    card("kdrama-1", "kdrama-1", "Vincenzo", "KDRAMA"),
    card("kpop-1", "kpop-1", "BTS", "KPOP"),
    card("meme-1", "meme-1", "Doge", "MEME"),
    card("vocaloid-1", "vocaloid-1", "Hatsune Miku", "VOCALOID"),
    card("anime-1", "anime-1", "One Piece")
  ];

  assert.equal(paniniAlbumForCard(catalogue[0]), "FILM");
  assert.equal(paniniAlbumForCard(catalogue[2]), "BRAINROT");
  assert.equal(paniniAlbumForCard(catalogue[3]), "DISNEY CHANNEL");
  assert.equal(paniniAlbumForCard(catalogue[4]), "KDRAMA");
  assert.equal(paniniAlbumForCard(catalogue[6]), "MEME");
  assert.equal(paniniAlbumForCard(catalogue[7]), "VOCALOID");
  assert.equal(paniniAlbumForCard(catalogue[8]), "One Piece");
  assert.deepEqual(
    Array.from(
      buildLicenseCatalogueTotals(catalogue)
        .sort((a, b) => a.license.localeCompare(b.license))
        .map(item => [item.license, item.total]),
      item => Array.from(item)
    ),
    [
      ["BRAINROT", 1],
      ["DISNEY CHANNEL", 1],
      ["FILM", 2],
      ["KDRAMA", 1],
      ["KPOP", 1],
      ["MEME", 1],
      ["One Piece", 1],
      ["VOCALOID", 1]
    ]
  );
});

test("ARTIST cards use their explicit license as their Panini album", () => {
  assert.equal(
    paniniAlbumForCard(card("kpop-artist", "kpop-artist", "KPOP", "ARTIST")),
    "KPOP"
  );
  assert.equal(
    paniniAlbumForCard(card("generic-artist", "generic-artist", "", "ARTIST")),
    "ARTIST"
  );
});

test("les possessions sont comptées dans leur album de catégorie", () => {
  const progress = buildLicenseProgress(
    [card("film-1", "film-1", "Alien", "FILM")],
    [{ license: "FILM", total: 2 }]
  );

  assert.equal(progress[0].owned, 1);
  assert.equal(progress[0].percent, 50);
});
