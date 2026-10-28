"""
Récupère TOUS les persos d'anime AniList en passant par la liste des animes
(contourne la limite de 5000 résultats par liste).

Sortie : persos_anime_complet.csv
Colonnes : id, personnage, anime_en, anime_romaji, image, favoris

Usage :
    python anilist_par_anime.py

Si le script s'arrête (Ctrl+C, coupure, PC éteint), relance simplement la même
commande : il reprend là où il en était grâce au fichier etat_scraping.json.
"""

import argparse
import csv
import datetime
import json
import os
import time

import requests

API = "https://graphql.anilist.co"
STATE_FILE = "etat_scraping.json"
OUT_FILE = "persos_anime_complet.csv"
FIELDS = ["id", "personnage", "anime_en", "anime_romaji", "image", "favoris", "anilist_media_id"]

Q_ANIMES = """
query ($page: Int, $gt: FuzzyDateInt, $lt: FuzzyDateInt) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    media(type: ANIME, isAdult: false, startDate_greater: $gt, startDate_lesser: $lt, sort: ID) {
      id
      popularity
      title { english romaji }
    }
  }
}
"""

Q_CHARS_BATCH = """
query ($ids: [Int]) {
  Page(perPage: 50) {
    media(id_in: $ids) {
      id
      characters(page: 1, perPage: 25, sort: FAVOURITES_DESC) {
        pageInfo { hasNextPage }
        nodes { id name { full } favourites image { large } }
      }
    }
  }
}
"""

Q_CHARS_ONE = """
query ($id: Int, $page: Int) {
  Media(id: $id) {
    characters(page: $page, perPage: 25, sort: FAVOURITES_DESC) {
      pageInfo { hasNextPage }
      nodes { id name { full } favourites image { large } }
    }
  }
}
"""

DELAY = 2.1  # ~28 requêtes/minute, sous la limite d'AniList


def gql(query, variables):
    """Envoie une requête et gère limite de requêtes, erreurs réseau et serveur."""
    while True:
        try:
            r = requests.post(API, json={"query": query, "variables": variables}, timeout=30)
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
        if r.status_code >= 400:
            print(f"  Erreur {r.status_code} renvoyée par AniList :")
            print("  " + r.text[:500])
            r.raise_for_status()
        time.sleep(DELAY)
        return r.json()["data"]


def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, encoding="utf-8") as f:
            s = json.load(f)
        print(f"Reprise : {len(s['anime'])} animes connus, {len(s['done'])} traités, "
              f"{len(s['chars'])} persos.")
        return s
    return {"anime": {}, "years_done": [], "done": [], "chars": {}}


def save_state(state):
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False)
    os.replace(tmp, STATE_FILE)


def write_csv(state):
    rows = sorted(state["chars"].values(), key=lambda c: c["favoris"] or 0, reverse=True)
    tmp = OUT_FILE + ".tmp"
    with open(tmp, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    os.replace(tmp, OUT_FILE)


def add_chars(state, anime_id, nodes):
    """Ajoute les persos ; si déjà connu, garde l'anime le plus populaire."""
    a = state["anime"][str(anime_id)]
    for n in nodes:
        cid = str(n["id"])
        existing = state["chars"].get(cid)
        if existing is None or a["pop"] > existing["_pop"]:
            state["chars"][cid] = {
                "id": n["id"],
                "personnage": n["name"]["full"],
                "anime_en": a["en"],
                "anime_romaji": a["romaji"],
                "anilist_media_id": int(anime_id),
                "image": n["image"]["large"],
                "favoris": n["favourites"],
                "_pop": a["pop"],
            }


def phase1_list_animes(state, first_year, last_year):
    print("=== Phase 1 : liste des animes par année ===")
    for year in range(first_year, last_year + 1):
        if year in state["years_done"]:
            continue
        gt = (year - 1) * 10000 + 9999   # strictement après l'année précédente
        lt = year * 10000 + 9999         # strictement avant l'année suivante
        page, count = 1, 0
        while True:
            data = gql(Q_ANIMES, {"page": page, "gt": gt, "lt": lt})["Page"]
            for m in data["media"]:
                state["anime"][str(m["id"])] = {
                    "en": m["title"]["english"] or "",
                    "romaji": m["title"]["romaji"] or "",
                    "pop": m["popularity"] or 0,
                }
                count += 1
            if not data["pageInfo"]["hasNextPage"]:
                break
            page += 1
        state["years_done"].append(year)
        save_state(state)
        if count:
            print(f"{year} : {count} animes (total {len(state['anime'])})")


def phase2_characters(state, batch_size):
    print("=== Phase 2 : persos de chaque anime ===")
    done = set(state["done"])
    todo = [aid for aid in state["anime"] if aid not in done]
    todo.sort(key=lambda aid: state["anime"][aid]["pop"], reverse=True)
    total = len(state["anime"])

    for i in range(0, len(todo), batch_size):
        batch = todo[i:i + batch_size]
        data = gql(Q_CHARS_BATCH, {"ids": [int(x) for x in batch]})["Page"]

        for m in data["media"]:
            aid = m["id"]
            conn = m["characters"]
            add_chars(state, aid, conn["nodes"])
            page = 1
            while conn["pageInfo"]["hasNextPage"]:
                page += 1
                conn = gql(Q_CHARS_ONE, {"id": aid, "page": page})["Media"]["characters"]
                add_chars(state, aid, conn["nodes"])

        for aid in batch:
            done.add(aid)
            state["done"].append(aid)

        n_batch = i // batch_size + 1
        if n_batch % 10 == 0:
            save_state(state)
            write_csv(state)
        print(f"Animes {len(done)}/{total} — {len(state['chars'])} persos")

    save_state(state)
    write_csv(state)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--batch", type=int, default=5, help="Animes par requête (baisser si erreur 400)")
    p.add_argument("--first-year", type=int, default=1900)
    p.add_argument("--last-year", type=int, default=datetime.date.today().year + 2)
    args = p.parse_args()

    state = load_state()
    try:
        phase1_list_animes(state, args.first_year, args.last_year)
        phase2_characters(state, args.batch)
    except KeyboardInterrupt:
        print("\nArrêt demandé, sauvegarde en cours...")
        save_state(state)
        write_csv(state)
        print("Sauvegardé. Relance la même commande pour reprendre.")
        return

    print(f"Terminé : {len(state['chars'])} persos dans {OUT_FILE}")


if __name__ == "__main__":
    main()
