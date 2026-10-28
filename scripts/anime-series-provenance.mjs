import { createHash } from "node:crypto";

export const ANIME_CATEGORY = "ANIME/MANGA";
export const identityText = value =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
const characterName = value => identityText(value).toUpperCase();
export const sha256 = value => createHash("sha256").update(value).digest("hex");

export function importIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    if (row.source !== "anilist") continue;
    const existing = index.get(row.source_id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(row)) {
      index.set(row.source_id, null);
    } else if (existing !== null) index.set(row.source_id, row);
  }
  return index;
}

export function mediaTitleIndex(state) {
  const english = new Map(),
    romaji = new Map();
  for (const [id, media] of Object.entries(state.anime ?? {})) {
    for (const [index, value] of [
      [english, media.en],
      [romaji, media.romaji]
    ]) {
      const name = identityText(value);
      if (!name) continue;
      const found = index.get(name) ?? new Set();
      found.add(Number(id));
      index.set(name, found);
    }
  }
  return { english, romaji };
}

// A numeric identifier or a title match alone never establishes provenance.
export function classifyOrigin(card, records, state) {
  if (card.categorie !== ANIME_CATEGORY)
    return {
      origin: "excluded_category",
      reason: "Another category is outside this operation."
    };
  if (card.source === "manual")
    return { origin: "manual", reason: "Explicit manual source namespace." };
  if (card.source !== "anilist")
    return {
      origin: "unknown",
      reason: "No verified AniList import namespace."
    };
  const record = records.get(card.source_id);
  const character = state.chars?.[card.source_id];
  if (!record || !character || String(character.id) !== card.source_id)
    return {
      origin: "unknown",
      reason: "Missing or conflicting source import record/character artifact."
    };
  if (
    characterName(record.nom) !== characterName(character.personnage) ||
    characterName(card.nom) !== characterName(record.nom)
  )
    return {
      origin: "unknown",
      reason:
        "Current or historical character identity differs; protect pending review."
    };
  return {
    origin: "anilist_confirmed",
    character_id: Number(character.id),
    record,
    reason:
      "AniList namespace + original import row + character artifact + matching character identity."
  };
}

export function resolveImportedMedia(card, origin, titles) {
  if (origin.origin !== "anilist_confirmed")
    return { media_id: null, reason: origin.reason };
  const record = origin.record;
  if (
    identityText(card.franchise_romaji) !==
    identityText(record.franchise_romaji)
  )
    return {
      media_id: null,
      reason: "Current source title differs from the import artifact."
    };
  const romaji = titles.romaji.get(identityText(record.franchise_romaji));
  const english = titles.english.get(identityText(record.franchise));
  let ids = romaji?.size ? [...romaji] : [...(english ?? [])];
  if (ids.length > 1 && english?.size) ids = ids.filter(id => english.has(id));
  if (ids.length !== 1)
    return {
      media_id: null,
      reason: "No unique media identity in the original import artifact."
    };
  return {
    media_id: ids[0],
    reason:
      "Exact imported romaji/English title points to a unique original media ID; API identity must also be checked."
  };
}

export function stableSeriesId(mediaId) {
  if (!Number.isSafeInteger(mediaId) || mediaId <= 0)
    throw new Error("Invalid AniList media identity");
  const hex = sha256(`yokkai:anime-series:v1:anilist:${mediaId}`).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export function inputFingerprint(card, sourceLicense) {
  return sha256(
    JSON.stringify([
      card.id,
      card.source,
      card.source_id,
      card.nom,
      card.categorie,
      card.franchise,
      card.franchise_romaji,
      sourceLicense
    ])
  );
}

export function candidateSeasonStem(title) {
  return identityText(title)
    .replace(
      /(?:\s*[:\-–]\s*|\s+)(?:(?:\d+(?:st|nd|rd|th)?|first|second|third|fourth|fifth|final)\s+season|season\s+\d+|part\s+\d+|cour\s+\d+)(?:\s+part\s+\d+)?$/i,
      ""
    )
    .trim();
}
