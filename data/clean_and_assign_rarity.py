"""
Nettoie le CSV scrapé (persos AniList) et assigne rarete_base par seuils absolus sur `favoris`.

Usage :
    python clean_and_assign_rarity.py input.csv output.csv

Étape 1 : lance le script une première fois avec SUGGEST_ONLY = True pour voir la distribution
de `favoris` et des suggestions de seuils basées sur les quantiles de CE CSV.
Étape 2 : reporte les valeurs qui te semblent cohérentes dans SEUILS ci-dessous, remets
SUGGEST_ONLY = False, et relance pour générer le CSV nettoyé avec les raretés assignées.

Ces seuils sont ensuite FIXES : même si tu rescrapes plus tard avec plus de persos (ou d'autres
catégories comme sport/musique), ils ne bougent pas — un perso avec 50 000 favoris sera toujours
LR, que la base contienne 500 ou 50 000 cartes.
"""

import csv
import sys
import hashlib
import json


def import_proof(row):
    """Only an explicitly recorded media ID can establish import provenance."""
    character = str(row.get("id", "")).strip()
    media = str(row.get("anilist_media_id", "")).strip()
    if not character.isdigit() or not media.isdigit() or int(media) <= 0:
        return {"anilist_media_id": "", "anilist_proof_version": "", "anilist_evidence_sha256": ""}
    nullable = lambda value: str(value or "").strip() or None
    title = row.get("anime_en") or row.get("anime_romaji")
    payload = ["anilist", int(character), int(media), nullable(title), nullable(row.get("anime_romaji"))]
    digest = hashlib.sha256(json.dumps(payload, ensure_ascii=False, separators=(", ", ": ")).encode("utf-8")).hexdigest()
    return {"anilist_media_id": int(media), "anilist_proof_version": "anilist-import-v1", "anilist_evidence_sha256": digest}

DEFAULT_IMAGE = "https://s4.anilist.co/file/anilistcdn/character/large/default.jpg"

SUGGEST_ONLY = False  # passe à False une fois les seuils choisis

# Seuils à ajuster après avoir regardé les suggestions (étape 1)
SEUILS = {
    "LR": 20000,
    "SSR": 5000,
    "SR": 1000,
    "R": 200,
    # en dessous de R -> C
}


def rarete_from_favoris(favoris: int) -> str:
    if favoris >= SEUILS["LR"]:
        return "LR"
    if favoris >= SEUILS["SSR"]:
        return "SSR"
    if favoris >= SEUILS["SR"]:
        return "SR"
    if favoris >= SEUILS["R"]:
        return "R"
    return "C"


def suggest_thresholds(favoris_list):
    favoris_sorted = sorted(favoris_list, reverse=True)
    n = len(favoris_sorted)

    def pct(p):
        idx = min(int(n * p), n - 1)
        return favoris_sorted[idx]

    seuil_lr = pct(0.005)
    seuil_ssr = pct(0.05)
    seuil_sr = pct(0.15)
    seuil_r = pct(0.40)

    # Comptage exact par palier (pas juste le %, le nombre réel de cartes)
    n_lr = sum(1 for f in favoris_list if f >= seuil_lr)
    n_ssr = sum(1 for f in favoris_list if seuil_ssr <= f < seuil_lr)
    n_sr = sum(1 for f in favoris_list if seuil_sr <= f < seuil_ssr)
    n_r = sum(1 for f in favoris_list if seuil_r <= f < seuil_sr)
    n_c = sum(1 for f in favoris_list if f < seuil_r)

    print(f"Total personnages exploitables : {n}")
    print("Suggestions de seuils (basées sur les percentiles de CE dataset) :")
    print(f"  LR  -> favoris >= {seuil_lr:<6} => {n_lr} cartes")
    print(f"  SSR -> favoris >= {seuil_ssr:<6} => {n_ssr} cartes")
    print(f"  SR  -> favoris >= {seuil_sr:<6} => {n_sr} cartes")
    print(f"  R   -> favoris >= {seuil_r:<6} => {n_r} cartes")
    print(f"  C   -> le reste             => {n_c} cartes")
    print("\nCe ne sont que des points de départ. Ajuste SEUILS à l'œil selon ce qui te semble")
    print("juste pour le jeu, puis repasse SUGGEST_ONLY à False.")


def main():
    if len(sys.argv) < 3:
        print("Usage: python clean_and_assign_rarity.py input.csv output.csv")
        sys.exit(1)

    input_path, output_path = sys.argv[1], sys.argv[2]

    rows = []
    seen_ids = set()
    dropped_no_image = 0
    dropped_duplicate = 0

    with open(input_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("image", "").strip() == DEFAULT_IMAGE:
                dropped_no_image += 1
                continue
            source_id = row.get("id", "").strip()
            if source_id in seen_ids:
                dropped_duplicate += 1
                continue
            seen_ids.add(source_id)
            rows.append(row)

    print(f"Lignes lues : {dropped_no_image + dropped_duplicate + len(rows)}")
    print(f"  Retirées (image par défaut) : {dropped_no_image}")
    print(f"  Retirées (id en doublon)    : {dropped_duplicate}")
    print(f"  Restantes                  : {len(rows)}")

    if SUGGEST_ONLY:
        favoris_list = [int(r["favoris"]) for r in rows if r.get("favoris", "").isdigit()]
        suggest_thresholds(favoris_list)
        return

    from collections import Counter
    fieldnames = [
        "source_id", "nom", "categorie", "franchise", "franchise_romaji",
        "image_url", "favoris_count", "rarete_base", "source",
        "anilist_media_id", "anilist_proof_version", "anilist_evidence_sha256",
    ]

    counts = Counter()
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in rows:
            favoris = int(r["favoris"]) if r.get("favoris", "").isdigit() else 0
            rarete = rarete_from_favoris(favoris)
            counts[rarete] += 1
            writer.writerow({
                "source_id": r.get("id", ""),
                "nom": r.get("personnage", ""),
                "categorie": "Anime/Manga",
                "franchise": r.get("anime_en", "") or r.get("anime_romaji", ""),
                "franchise_romaji": r.get("anime_romaji", ""),
                "image_url": r.get("image", ""),  # remplacé par l'URL Supabase après re-upload
                "favoris_count": favoris,
                "rarete_base": rarete,
                "source": "anilist",
                **import_proof(r),
            })

    print(f"\nFichier nettoyé écrit : {output_path}")
    print("Répartition finale par rareté (avec les SEUILS actuels) :")
    for rarete in ["LR", "SSR", "SR", "R", "C"]:
        print(f"  {rarete:<3} : {counts[rarete]} cartes")


if __name__ == "__main__":
    main()
