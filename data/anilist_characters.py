"""
Export des personnages d'anime AniList en CSV pour le jeu de cartes.
Colonnes : id, personnage, anime_en, anime_romaji, image, favoris

Usage :
    python anilist_characters.py --pages 2      # test (environ 100 persos)
    python anilist_characters.py                # toute la base
    python anilist_characters.py --start 351    # reprendre à la page 351
"""

import argparse
import csv
import os
import time

import requests

API = "https://graphql.anilist.co"

QUERY = """
query ($page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    characters(sort: FAVOURITES_DESC) {
      id
      name { full }
      favourites
      image { large }
      media(type: ANIME, perPage: 1, sort: POPULARITY_DESC) {
        nodes { title { english romaji } }
      }
    }
  }
}
"""

FIELDS = ["id", "personnage", "anime_en", "anime_romaji", "image", "favoris"]


def fetch_page(page):
    """Récupère une page en gérant la limite de requêtes et les erreurs réseau."""
    while True:
        try:
            r = requests.post(API, json={"query": QUERY, "variables": {"page": page}}, timeout=30)
        except requests.RequestException as e:
            print(f"  Erreur réseau ({e}), nouvel essai dans 15s...")
            time.sleep(15)
            continue
        if r.status_code == 429:
            wait = int(r.headers.get("Retry-After", 60))
            print(f"  Limite atteinte, pause de {wait}s...")
            time.sleep(wait + 1)
            continue
        if r.status_code >= 500:
            print(f"  Erreur serveur {r.status_code}, nouvel essai dans 15s...")
            time.sleep(15)
            continue
        r.raise_for_status()
        return r.json()["data"]["Page"]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--pages", type=int, default=0, help="Nombre max de pages (0 = tout)")
    p.add_argument("--start", type=int, default=1, help="Page de départ")
    p.add_argument("--delay", type=float, default=2.1, help="Pause entre requêtes (s)")
    p.add_argument("--out", default="persos_anime.csv")
    args = p.parse_args()

    append = args.start > 1 and os.path.exists(args.out)
    kept = 0

    with open(args.out, "a" if append else "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        if not append:
            w.writeheader()

        page = args.start
        while True:
            data = fetch_page(page)
            for c in data["characters"]:
                nodes = c["media"]["nodes"]
                if not nodes:  # perso sans anime (manga / jeu uniquement) -> ignoré
                    continue
                title = nodes[0]["title"]
                w.writerow({
                    "id": c["id"],
                    "personnage": c["name"]["full"],
                    "anime_en": title["english"] or "",
                    "anime_romaji": title["romaji"] or "",
                    "image": c["image"]["large"],
                    "favoris": c["favourites"],
                })
                kept += 1
            f.flush()
            print(f"Page {page} OK — {kept} persos récupérés")

            if not data["pageInfo"]["hasNextPage"]:
                print("Fin de la base.")
                break
            if args.pages and page - args.start + 1 >= args.pages:
                break
            page += 1
            time.sleep(args.delay)

    print(f"Terminé : {kept} persos dans {args.out}")
    print(f"Pour continuer plus tard : --start {page + 1}")


if __name__ == "__main__":
    main()
