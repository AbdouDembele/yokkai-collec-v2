import test from "node:test";
import assert from "node:assert/strict";
import { importCards } from "../scripts/import-cards.mjs";
import {
  anilistEvidenceDigest,
  immutableAnilistImagePath
} from "../scripts/anilist-import-provenance.mjs";

test("stable AniList import preflights existing characters before images, retries immutable objects, and uses only insert RPC", async () => {
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  const downloads = [],
    uploads = [],
    calls = [],
    written = [];
  const client = {
    from(table) {
      assert.equal(table, "cards");
      return {
        select() {
          return {
            eq() {
              return {
                in: async () => ({ data: [{ source_id: "101" }], error: null })
              };
            }
          };
        }
      };
    },
    storage: {
      from() {
        return {
          upload: async (path, _bytes, options) => {
            uploads.push({ path, options });
            return { error: { statusCode: "409", message: "Already exists" } };
          },
          getPublicUrl: path => ({
            data: { publicUrl: "https://example.test/" + path }
          })
        };
      }
    },
    async rpc(name, args) {
      calls.push({ name, args });
      return {
        data: args.p_rows.map(r => ({
          source_id: r.source_id,
          status: "ASSIGNED_APPROVED_MEDIA"
        })),
        error: null
      };
    }
  };
  const title = "Tokyo Ghoul √A";
  const rows = ["101", "102"].map(source_id => ({
    source_id,
    nom: "Character " + source_id,
    source: "anilist",
    categorie: "Anime/Manga",
    franchise: title,
    franchise_romaji: title,
    rarete_base: "C",
    favoris_count: "1",
    image_url: "https://s4.anilist.co/" + source_id + ".png",
    anilist_media_id: "20850",
    anilist_proof_version: "anilist-import-v1",
    anilist_evidence_sha256: anilistEvidenceDigest(
      source_id,
      20850,
      title,
      title
    )
  }));
  const stats = await importCards({
    rows,
    client,
    stableBinders: true,
    fetchImage: async url => {
      downloads.push(url);
      return new Response(bytes, { headers: { "content-type": "image/png" } });
    },
    sleep: async () => {},
    log: () => {},
    onWritten: async ids => written.push(...ids)
  });
  assert.equal(stats.imported, 1);
  assert.equal(stats.duplicates, 1);
  assert.equal(downloads.length, 1);
  assert(downloads[0].includes("/102.png"));
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].options.upsert, false);
  assert(uploads[0].path.endsWith(immutableAnilistImagePath("", bytes)));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "import_anilist_cards");
  assert.equal(calls[0].args.p_rows[0].franchise, title);
  assert.equal(calls[0].args.p_rows[0].anilist_media_id, 20850);
  assert.equal(calls[0].args.p_rows[0].source_id, "102");
  assert.deepEqual(written, [2]);
});
