import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { importCards, splitFranchises } from "../scripts/import-cards.mjs";

const row = {
  source_id: "english-rejection",
  nom: "X",
  categorie: "TEST",
  source: "manual",
  image_url: "https://example.com/card.png",
  rarete_base: "C"
};

test("admin CSV rejection details receive English validator messages", async () => {
  const cases = [
    [{ nom: "" }, "Empty field: nom"],
    [{ rarete_base: "invalid" }, "Invalid rarity."],
    [{ image_url: "http://example.com/card.png" }, "The image must use HTTPS."],
    [
      { image_url: "https://127.0.0.1/card.png" },
      "The image must use a public IP address."
    ],
    [{}, "Invalid or undecodable image/png content."]
  ];
  for (const [patch, message] of cases) {
    const failures = [];
    const result = await importCards({
      rows: [{ ...row, ...patch }],
      client: {},
      fetchImage: async () =>
        new Response("broken", { headers: { "content-type": "image/png" } }),
      log: () => {},
      sleep: async () => {},
      onFailure: async failure => failures.push(failure)
    });
    assert.equal(result.skipped, 1);
    assert.equal(result.imported, 0);
    assert.equal(failures[0].record, 1);
    assert.equal(failures[0].message, message);
  }
  assert.throws(() => splitFranchises("X".repeat(201)), {
    message: "A license cannot exceed 200 characters."
  });
});

test("admin dates and Kara balances use en-US display formatting", () => {
  const read = path =>
    readFileSync(new URL("../" + path, import.meta.url), "utf8");
  const reports = read("app/admin/reports/report-list.tsx");
  const players = read("app/admin/players/player-manager.tsx");
  assert.match(reports, /new Intl.DateTimeFormat\("en-US"/);
  assert.equal((players.match(/toLocaleString\("en-US"\)/g) ?? []).length, 3);
  assert.doesNotMatch(reports + players, /"fr-FR"/);
});
