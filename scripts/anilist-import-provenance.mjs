import { createHash } from "node:crypto";

export const isAnilistAnime = card =>
  card.source === "anilist" &&
  card.categorie?.trim().toUpperCase() === "ANIME/MANGA";

// PostgreSQL jsonb_build_array text: comma + space between JSON scalars.
// Do not infer an ID from a title or treat a character ID as a media ID.
export function anilistEvidenceDigest(characterId, mediaId, title, romaji) {
  const nullable = value => String(value ?? "").trim() || null;
  const tuple = [
    "anilist",
    Number(characterId),
    Number(mediaId) || null,
    nullable(title),
    nullable(romaji)
  ];
  return createHash("sha256")
    .update("[" + tuple.map(value => JSON.stringify(value)).join(", ") + "]")
    .digest("hex");
}

export function anilistImportRow(card, input) {
  return {
    ...card,
    categorie: "ANIME/MANGA",
    anilist_media_id: /^\d+$/.test(String(input.anilist_media_id ?? ""))
      ? Number(input.anilist_media_id)
      : null,
    anilist_proof_version: input.anilist_proof_version ?? null,
    anilist_evidence_sha256: input.anilist_evidence_sha256 ?? null
  };
}

export function immutableAnilistImagePath(prefix, bytes) {
  return `${prefix}-${createHash("sha256").update(bytes).digest("hex")}`;
}
