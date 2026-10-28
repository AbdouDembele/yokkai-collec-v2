import { createReadStream, readFileSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { parse } from "csv-parse";
import { createClient } from "@supabase/supabase-js";
import {
  checked,
  createImageRequestLimiter,
  downloadImage,
  imagePath,
  retry,
  validateImageBytes
} from "./import-cards.mjs";

const REQUIRED = [
  "record",
  "operation",
  "id",
  "nom",
  "categorie",
  "franchise",
  "rarete",
  "ancienne_rarete",
  "image_url",
  "erreur_initiale",
  "code_http_initial",
  "source",
  "source_id",
  "correspondance",
  "domaine",
  "url_valide"
];
const OUT = "logs/refused-images-2026-10-02";

async function readCsv(path) {
  const rows = [];
  const parser = createReadStream(path).pipe(
    parse({
      bom: true,
      columns(headers) {
        const missing = REQUIRED.filter(column => !headers.includes(column));
        if (missing.length)
          throw new Error(`Colonnes manquantes : ${missing.join(", ")}`);
        return headers;
      },
      skip_empty_lines: true
    })
  );
  for await (const row of parser) rows.push(row);
  return rows;
}

const identity = row => JSON.stringify([row.source, row.source_id]);
const targetPath = row =>
  `${imagePath(row)}-${createHash("sha256").update(row.image_url).digest("hex").slice(0, 16)}`;

async function loadScope(csv, planPath) {
  const rows = await readCsv(csv);
  if (rows.length !== 1322)
    throw new Error(
      `Périmètre inattendu : ${rows.length} lignes au lieu de 1322.`
    );
  const unique = new Set(rows.map(identity));
  if (unique.size !== rows.length)
    throw new Error("Le CSV de reprise contient des doublons.");
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const updates = new Map(plan.updates.map(item => [item.id, item]));
  const inserts = new Map(plan.inserts.map(item => [identity(item), item]));
  for (const row of rows) {
    row.kind =
      row.operation === "Mise à jour"
        ? "update"
        : row.operation === "Création"
          ? "insert"
          : "";
    if (!row.kind)
      throw new Error(
        `Opération inconnue ligne ${row.record} : ${row.operation}`
      );
    const planned =
      row.kind === "update" ? updates.get(row.id) : inserts.get(identity(row));
    if (!planned)
      throw new Error(`Ligne ${row.record} absente du plan initial.`);
    for (const field of [
      "nom",
      "categorie",
      "source",
      "source_id",
      "image_url"
    ]) {
      if (String(row[field]) !== String(planned[field])) {
        throw new Error(
          `Ligne ${row.record} diffère du plan initial (${field}).`
        );
      }
    }
    row.planned = planned;
    row.path = targetPath(row);
  }
  return rows;
}

async function selectAllCards(client) {
  const rows = [];
  const columns =
    "id,source,source_id,nom,categorie,franchise,franchise_romaji,rarete_base,image_url,favoris_count,description,date_ajout";
  for (let from = 0; ; from += 1000) {
    const page = await retry(() =>
      checked(
        client
          .from("cards")
          .select(columns)
          .order("id")
          .range(from, from + 999)
      )
    );
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function stableHash(rows) {
  return createHash("sha256")
    .update(JSON.stringify(rows.sort((a, b) => a.id.localeCompare(b.id))))
    .digest("hex");
}

async function preflight(client, rows) {
  const all = await selectAllCards(client);
  const byId = new Map(all.map(card => [card.id, card]));
  const byIdentity = new Map(all.map(card => [identity(card), card]));
  const targetIds = new Set(
    rows.filter(row => row.kind === "update").map(row => row.id)
  );
  const targetIdentities = new Set(rows.map(identity));
  for (const row of rows) {
    const current =
      row.kind === "update" ? byId.get(row.id) : byIdentity.get(identity(row));
    if (row.kind === "update" && !current)
      throw new Error(
        `Carte existante introuvable, ligne ${row.record} (${row.nom}).`
      );
    if (current) {
      for (const field of ["nom", "categorie", "source", "source_id"]) {
        if (String(current[field]) !== String(row[field]))
          throw new Error(
            `Identité DB inattendue ligne ${row.record} (${field}).`
          );
      }
    }
  }
  const outside = all.filter(
    card => !targetIds.has(card.id) && !targetIdentities.has(identity(card))
  );
  const snapshot = {
    date: new Date().toISOString(),
    count: outside.length,
    hash: stableHash(outside)
  };
  await writeFile(
    `${OUT}/outside-before.json`,
    JSON.stringify(snapshot, null, 2)
  );
  return {
    catalogue: all.length,
    targetsExisting: rows.filter(row => byIdentity.has(identity(row))).length,
    targetsMissing: rows.filter(row => !byIdentity.has(identity(row))).length,
    outside: snapshot
  };
}

function errorEntry(row, stage, error) {
  return {
    record: Number(row.record),
    nom: row.nom,
    categorie: row.categorie,
    source_id: row.source_id,
    url: row.image_url,
    domaine: row.domaine,
    stage,
    http: Number(error.status) || null,
    message: error.message
  };
}

async function validateStored(client, bucket, row, publicUrl) {
  const stored = await retry(() =>
    checked(client.storage.from(bucket).download(row.path))
  );
  const bytes = Buffer.from(await stored.arrayBuffer());
  const type = stored.type.split(";")[0].toLowerCase();
  validateImageBytes(bytes, type);
  const publicImage = await retry(() => downloadImage(publicUrl));
  return {
    bytes: publicImage.bytes.length,
    contentType: publicImage.contentType
  };
}

async function processRows({ client, bucket, rows, concurrency, logPath }) {
  const limitedFetch = createImageRequestLimiter();
  const stats = {
    selected: rows.length,
    validated: 0,
    downloaded: 0,
    updated: 0,
    inserted: 0,
    already: 0,
    skipped: 0,
    http403: 0,
    http404: 0,
    http429: 0,
    otherHttp: 0,
    validation: 0,
    format: 0
  };
  const successes = [];
  const failures = [];
  let cursor = 0;
  const fail = async entry => {
    failures.push(entry);
    stats.skipped++;
    if (entry.http === 403) stats.http403++;
    else if (entry.http === 404) stats.http404++;
    else if (entry.http === 429) stats.http429++;
    else if (entry.http) stats.otherHttp++;
    else if (entry.stage === "validation") stats.validation++;
    else if (entry.stage === "format") stats.format++;
    await appendFile(
      logPath,
      JSON.stringify({ date: new Date().toISOString(), ...entry }) + "\n"
    );
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
      while (cursor < rows.length) {
        const row = rows[cursor++];
        if (!/^true$/i.test(row.url_valide)) {
          await fail(
            errorEntry(row, "validation", new Error("URL vide ou invalide."))
          );
          continue;
        }
        stats.validated++;
        const publicUrl = client.storage.from(bucket).getPublicUrl(row.path)
          .data.publicUrl;
        const existing = await retry(() =>
          checked(
            client
              .from("cards")
              .select("id,image_url,source,source_id,nom,categorie")
              .eq("source", row.source)
              .eq("source_id", row.source_id)
              .maybeSingle()
          )
        );
        if (existing?.image_url === publicUrl) {
          try {
            const verified = await validateStored(
              client,
              bucket,
              row,
              publicUrl
            );
            stats.already++;
            successes.push({
              ...errorEntry(row, "complete", {}),
              id: existing.id,
              publicUrl,
              ...verified,
              already: true
            });
            continue;
          } catch {}
        }
        let image;
        try {
          image = await retry(() => downloadImage(row.image_url, limitedFetch));
          stats.downloaded++;
        } catch (error) {
          await fail(
            errorEntry(
              row,
              error.message.includes("invalide") ? "format" : "download",
              error
            )
          );
          continue;
        }
        try {
          await retry(() =>
            checked(
              client.storage.from(bucket).upload(row.path, image.bytes, {
                contentType: image.contentType,
                upsert: true,
                cacheControl: "3600"
              })
            )
          );
        } catch (error) {
          await fail(errorEntry(row, "storage-upload", error));
          continue;
        }
        try {
          if (row.kind === "update") {
            const updated = await retry(() =>
              checked(
                client
                  .from("cards")
                  .update({ image_url: publicUrl })
                  .eq("id", row.id)
                  .eq("source", row.source)
                  .eq("source_id", row.source_id)
                  .select("id,image_url")
                  .single()
              )
            );
            if (updated.image_url !== publicUrl)
              throw new Error("L'URL enregistrée ne correspond pas.");
            stats.updated++;
          } else {
            if (existing)
              throw new Error(
                "Une carte existe déjà avec cette identité mais une autre image."
              );
            const inserted = await retry(() =>
              checked(
                client
                  .from("cards")
                  .insert({ ...row.planned, image_url: publicUrl })
                  .select("id,image_url")
                  .single()
              )
            );
            row.id = inserted.id;
            stats.inserted++;
          }
          const verified = await validateStored(client, bucket, row, publicUrl);
          successes.push({
            ...errorEntry(row, "complete", {}),
            id: row.id,
            publicUrl,
            ...verified,
            already: false
          });
        } catch (error) {
          await fail(errorEntry(row, "database-or-verification", error));
        }
      }
    })
  );
  return { stats, successes, failures };
}

async function verifyOutside(client, rows) {
  const before = JSON.parse(readFileSync(`${OUT}/outside-before.json`, "utf8"));
  const targetIds = new Set(
    rows.filter(row => row.kind === "update").map(row => row.id)
  );
  const targetIdentities = new Set(rows.map(identity));
  const all = await selectAllCards(client);
  const outside = all.filter(
    card => !targetIds.has(card.id) && !targetIdentities.has(identity(card))
  );
  const after = {
    date: new Date().toISOString(),
    count: outside.length,
    hash: stableHash(outside)
  };
  await writeFile(`${OUT}/outside-after.json`, JSON.stringify(after, null, 2));
  if (before.count !== after.count || before.hash !== after.hash)
    throw new Error("Des cartes hors périmètre ont changé : arrêt immédiat.");
  return after;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      csv: {
        type: "string",
        default: "data/cartes_images_refusees_2026-10-02.csv"
      },
      plan: { type: "string", default: "logs/merged-import/plan.json" },
      bucket: { type: "string", default: "card-images" },
      concurrency: { type: "string", default: "3" }
    }
  });
  const command = positionals[0];
  if (!["preflight", "sample", "run", "verify-outside"].includes(command))
    throw new Error("Commande attendue : preflight|sample|run|verify-outside");
  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5)
    throw new Error("Concurrence attendue entre 1 et 5.");
  await mkdir(OUT, { recursive: true });
  const rows = await loadScope(values.csv, values.plan);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Variables Supabase absentes.");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(60000) })
    }
  });
  if (command === "preflight") {
    console.log(JSON.stringify(await preflight(client, rows), null, 2));
    return;
  }
  if (command === "verify-outside") {
    console.log(JSON.stringify(await verifyOutside(client, rows), null, 2));
    return;
  }
  const selected =
    command === "sample"
      ? [
          rows.find(
            row =>
              row.domaine === "static.wikia.nocookie.net" &&
              /true/i.test(row.url_valide)
          ),
          rows.find(
            row =>
              row.domaine !== "static.wikia.nocookie.net" &&
              /true/i.test(row.url_valide)
          )
        ].filter(Boolean)
      : rows;
  const logPath = resolve(`${OUT}/${command}-errors.jsonl`);
  await writeFile(logPath, "");
  const result = await processRows({
    client,
    bucket: values.bucket,
    rows: selected,
    concurrency,
    logPath
  });
  await writeFile(
    `${OUT}/${command}-report.json`,
    JSON.stringify(result, null, 2)
  );
  console.log(JSON.stringify(result, null, 2));
  if (result.failures.length) process.exitCode = 2;
}

main().catch(error => {
  console.error(`Reprise arrêtée : ${error.message}`);
  process.exitCode = 1;
});
