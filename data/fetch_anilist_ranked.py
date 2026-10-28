"""
Récupère les personnages d'anime depuis l'API AniList, classés en deux temps :
1. Les anime sont classés par popularité GLOBALE (champ `popularity` d'AniList) et regroupés
   en tiers, tous années confondues
2. À l'intérieur de chaque anime, les personnages sont classés par `favourites`
La rareté finale d'un perso dépend du croisement des deux : être le perso le plus populaire d'un
anime obscur ne donne pas la même rareté qu'être le 3e perso le plus populaire d'un anime culte.

Le fetch est découpé ANNÉE PAR ANNÉE (comme pour le scraping précédent) pour rester résumable :
si ça plante ou que tu dois t'arrêter, relancer le script reprend à l'année suivante sans
retélécharger ce qui est déjà en cache.

Fonctionne en 3 passes, choisies en argument de ligne de commande (pas besoin d'éditer le fichier) :
    python fetch_anilist_ranked.py fetch     -> télécharge année par année, cache localement
    python fetch_anilist_ranked.py suggest   -> affiche la distribution pour les TIERS actuels
    python fetch_anilist_ranked.py export    -> écrit le CSV final avec la rareté assignée

Réglages encore à ajuster DANS le fichier (ce sont des choix de design, pas un mode d'exécution) :
YEAR_START, YEAR_END, CHARACTERS_PER_ANIME, TIERS, RARITY_BY_TIER.
"""

import argparse
import json
import os
import sys
import time
import datetime
import urllib.request
import urllib.error

API_URL = "https://graphql.anilist.co"
CACHE_FILE = "anilist_cache.json"
DEFAULT_IMAGE_MARKERS = ("default.jpg",)  # AniList sert plusieurs tailles du même placeholder

# --- Réglages (tuning du modèle, pas des modes d'exécution) -----------------

YEAR_START = 1960
YEAR_END = datetime.date.today().year  # inclut l'année en cours
CHARACTERS_PER_ANIME = 25    # top N persos par anime (triés par favourites)
REQUEST_DELAY_SECONDS = 2.5  # pause entre chaque appel API, AniList est strict sur le rate limit

# Tiers d'anime par RANG GLOBAL de popularité (calculé sur l'ensemble des années au moment du
# suggest/export, pas pendant le fetch). Rang 1 = anime le plus populaire tous temps confondus.
# Ajuste ces bornes une fois que tu as vu la distribution réelle avec MODE = "suggest".
TIERS = [
    # (rang_max_inclus, nom_tier)
    (50, "S"),
    (300, "A"),
    (1500, "B"),
    (float("inf"), "C"),
]

# Pour chaque tier, la rareté attribuée selon le RANG du perso au sein de son anime
# (liste de (rang_max_inclus, rarete), le reste tombe dans la dernière catégorie du tier)
RARITY_BY_TIER = {
    "S": [(1, "LR"), (3, "SSR"), (8, "SR"), (20, "R")],       # au-delà -> C
    "A": [(1, "SSR"), (5, "SR"), (15, "R")],                   # au-delà -> C
    "B": [(2, "SR"), (10, "R")],                                # au-delà -> C
    "C": [(3, "R")],                                            # au-delà -> C
}


def rarity_for(tier: str, rank_in_anime: int) -> str:
    for max_rank, rarete in RARITY_BY_TIER[tier]:
        if rank_in_anime <= max_rank:
            return rarete
    return "C"


def tier_for(global_rank: int) -> str:
    for max_rank, tier in TIERS:
        if global_rank <= max_rank:
            return tier
    return TIERS[-1][1]


# --- Appels API ---------------------------------------------------------------

class ForbiddenError(Exception):
    pass


def gql(query: str, variables: dict) -> dict:
    body = json.dumps({"query": query, "variables": variables}).encode()
    req = urllib.request.Request(
        API_URL, data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            # AniList bloque souvent l'UA par défaut de urllib ("Python-urllib/3.x") avec un 403
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        },
    )
    while True:
        try:
            with urllib.request.urlopen(req) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                retry_after = int(e.headers.get("Retry-After", "15"))
                print(f"    Rate limité, pause de {retry_after}s...")
                time.sleep(retry_after)
                continue
            if e.code == 403:
                raise ForbiddenError(
                    "HTTP 403 : AniList refuse la requête (blocage UA/IP). "
                    "Voir le message d'aide ci-dessous."
                )
            raise


ANIME_QUERY = """
query ($page: Int, $year: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(type: ANIME, seasonYear: $year, sort: POPULARITY_DESC) {
      id
      title { romaji english }
      popularity
    }
  }
}
"""

CHARACTERS_QUERY = """
query ($id: Int) {
  Media(id: $id) {
    characters(sort: FAVOURITES_DESC, page: 1, perPage: %d) {
      edges {
        node {
          id
          name { full }
          image { large }
          favourites
        }
      }
    }
  }
}
""" % CHARACTERS_PER_ANIME


def fetch_anime_for_year(year: int) -> list:
    anime = []
    page = 1
    while True:
        data = gql(ANIME_QUERY, {"page": page, "year": year})
        media_page = data["data"]["Page"]
        for m in media_page["media"]:
            anime.append({
                "id": m["id"],
                "titre_en": (m["title"]["english"] or m["title"]["romaji"] or ""),
                "titre_romaji": m["title"]["romaji"] or "",
                "popularity": m["popularity"],
                "annee": year,
            })
        if not media_page["pageInfo"]["hasNextPage"]:
            break
        page += 1
        time.sleep(REQUEST_DELAY_SECONDS)
    return anime


def fetch_characters_for(anime_id: int) -> list:
    data = gql(CHARACTERS_QUERY, {"id": anime_id})
    media = data.get("data", {}).get("Media")
    if not media:
        return []
    out = []
    for edge in media["characters"]["edges"]:
        node = edge["node"]
        image = (node.get("image") or {}).get("large") or ""
        if any(marker in image for marker in DEFAULT_IMAGE_MARKERS):
            continue
        out.append({
            "id": node["id"],
            "nom": node["name"]["full"] or "",
            "image": image,
            "favoris": node.get("favourites") or 0,
        })
    return out


def load_cache() -> dict:
    if os.path.exists(CACHE_FILE):
        with open(CACHE_FILE, encoding="utf-8") as f:
            return json.load(f)
    return {"years_done": [], "anime": []}


def save_cache(cache: dict):
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False)


def do_fetch():
    cache = load_cache()
    years_done = set(cache["years_done"])
    all_years = list(range(YEAR_START, YEAR_END + 1))
    remaining = [y for y in all_years if y not in years_done]

    if not remaining:
        print("Toutes les années sont déjà en cache. Passe à MODE = 'suggest'.")
        return

    print(f"Années restantes à traiter : {len(remaining)}/{len(all_years)}")

    for year in remaining:
        print(f"\n=== Année {year} ===")
        try:
            anime_list = fetch_anime_for_year(year)
        except ForbiddenError as e:
            print(f"\n{e}")
            print("Le script s'arrête ici pour ne pas boucler inutilement sur toutes les années.")
            print("Pistes : 1) attends 10-15 min si tu as fait beaucoup de requêtes récemment")
            print("(ban IP temporaire), 2) essaie depuis une autre connexion (partage de")
            print("connexion mobile, VPN), 3) si ça persiste, colle-moi le résultat de :")
            print("   curl -i https://graphql.anilist.co -H \"Content-Type: application/json\"")
            print("   -d \"{\\\"query\\\":\\\"{ Media(id:1){id} }\\\"}\"")
            sys.exit(1)
        except Exception as e:
            print(f"  Erreur récupération anime {year} : {e} — année ignorée, relance le script"
                  f" pour réessayer (elle ne sera pas marquée comme faite)")
            continue

        print(f"  {len(anime_list)} anime trouvés pour {year}")
        for i, anime in enumerate(anime_list, start=1):
            print(f"  [{i}/{len(anime_list)}] {anime['titre_en']}")
            try:
                time.sleep(REQUEST_DELAY_SECONDS)
                chars = fetch_characters_for(anime["id"])
            except Exception as e:
                print(f"    Erreur persos : {e} — ignoré")
                chars = []
            cache["anime"].append({**anime, "characters": chars})

        # une année entière traitée -> on la marque faite et on sauvegarde tout de suite
        cache["years_done"].append(year)
        save_cache(cache)
        print(f"  Année {year} terminée et sauvegardée ({len(cache['anime'])} anime au total en cache)")

    print(f"\nFetch terminé. Cache écrit : {CACHE_FILE}")


# --- Suggestion / export ---------------------------------------------------

def rank_globally(cache: dict) -> list:
    """Retourne la liste des anime triés par popularité décroissante, tous années confondues,
    avec leur rang global (1 = le plus populaire)."""
    ordered = sorted(cache["anime"], key=lambda a: -(a["popularity"] or 0))
    for rank, anime in enumerate(ordered, start=1):
        anime["global_rank"] = rank
    return ordered


def build_rows(cache: dict):
    ranked_anime = rank_globally(cache)
    rows = []
    for anime in ranked_anime:
        tier = tier_for(anime["global_rank"])
        for rank, char in enumerate(
            sorted(anime["characters"], key=lambda c: -c["favoris"]), start=1
        ):
            rarete = rarity_for(tier, rank)
            rows.append({
                "source_id": str(char["id"]),
                "nom": char["nom"],
                "categorie": "Anime/Manga",
                "franchise": anime["titre_en"],
                "franchise_romaji": anime["titre_romaji"],
                "image_url": char["image"],
                "favoris_count": char["favoris"],
                "rarete_base": rarete,
                "source": "anilist",
                "_anime_tier": tier,
                "_anime_global_rank": anime["global_rank"],
            })
    return rows


def do_suggest():
    cache = load_cache()
    if not cache["anime"]:
        print(f"Cache vide ({CACHE_FILE}) — lance d'abord MODE = 'fetch'.")
        sys.exit(1)

    missing_years = [y for y in range(YEAR_START, YEAR_END + 1) if y not in set(cache["years_done"])]
    if missing_years:
        print(f"Attention : {len(missing_years)} année(s) pas encore fetchées "
              f"({missing_years[0]}...{missing_years[-1]}) — la distribution ci-dessous est "
              f"partielle. Relance MODE = 'fetch' pour continuer, ou ignore si c'est voulu.\n")

    rows = build_rows(cache)

    from collections import Counter
    counts = Counter(r["rarete_base"] for r in rows)

    print(f"Total anime en cache : {len(cache['anime'])}")
    print(f"Total personnages : {len(rows)}")
    print("\nRépartition par rareté :")
    for r in ["LR", "SSR", "SR", "R", "C"]:
        print(f"  {r:<3} : {counts[r]}")

    ranked_anime = rank_globally(cache)
    tier_anime_count = Counter(tier_for(a["global_rank"]) for a in ranked_anime)
    print("\nNombre d'anime par tier :")
    for _, tier in TIERS:
        print(f"  Tier {tier} : {tier_anime_count[tier]} anime")

    print("\nAjuste TIERS / RARITY_BY_TIER en tête de script si la distribution ne te convient")
    print("pas, puis relance 'suggest' (pas besoin de refetch) jusqu'à être satisfait.")
    print("Repasse ensuite MODE = 'export' pour générer le CSV final.")


def do_export():
    cache = load_cache()
    rows = build_rows(cache)

    fieldnames = [
        "source_id", "nom", "categorie", "franchise", "franchise_romaji",
        "image_url", "favoris_count", "rarete_base", "source",
    ]
    import csv
    with open("anime_clean.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in rows:
            writer.writerow({k: r[k] for k in fieldnames})

    print(f"Fichier écrit : anime_clean.csv ({len(rows)} lignes)")


def main():
    parser = argparse.ArgumentParser(
        description="Fetch, aperçu ou export des cartes anime classées via AniList."
    )
    parser.add_argument(
        "mode", choices=["fetch", "suggest", "export", "all"],
        help="fetch: télécharge (résumable) · suggest: aperçu de la distribution · "
             "export: écrit le CSV final · all: fetch puis suggest puis export d'affilée",
    )
    args = parser.parse_args()

    if args.mode in ("fetch", "all"):
        do_fetch()
    if args.mode in ("suggest", "all"):
        do_suggest()
    if args.mode in ("export", "all"):
        do_export()


if __name__ == "__main__":
    main()
