# Corrections Persona et Mob Psycho 100

Demandées par Abdou le 26 octobre 2026 après l'audit des petits classeurs.
La dernière instruction exclut Fate de cette opération.

Cette correction est désormais la première étape du lot élargi demandé sur toute
la liste. Voir [l'audit complet](small-anime-binder-merges-20261026.md) et la seconde
recette `merge_small_anime_binders_20261026.sql`, qui s'exécute après celle-ci dans
la même transaction.

## Changements préparés

- **Igor**, UUID `4a05bda1-0d64-4bb0-9e48-8e1aa59bb68b`, passe
  d'ANIME/MANGA à VIDEO GAMES. Sa carte, son image et ses liens Persona 5
  et PERSONA 3 restent présents. Les deux classeurs anime qui ne contenaient
  que cette carte cessent automatiquement d'apparaître. Les classeurs de jeux
  vidéo existants gardent leurs identités : Persona 5 contient alors 38 cartes
  et PERSONA 3, 54 cartes selon l'inventaire préparatoire.
- **Mob Psycho 100 I**, 5 cartes, rejoint le classeur Mob Psycho 100 existant,
  103 cartes : 108 cartes distinctes après correction. Une règle exacte, un alias
  et une redirection de l'ancienne clé préservent les recherches et les favoris.
- Les classeurs et cartes Fate sont intégralement conservés en l'état.

## Application

Recette manuelle : `supabase/recipes/correct_persona_mob_binders_20261026.sql`.
Aucune migration ni nouveau privilège. Le SQL n'est pas exécuté au déploiement.

Suivre la coordination SQL de `COLLABORATION.md`, vérifier le registre réel,
prendre et valider une sauvegarde privée, puis répéter le corps de transaction
avec rollback avant application. La version de projection est épinglée ; les
identités d'Igor et du classeur Mob sont vérifiées. Les sources, preuves, cartes
possédées, wishlists et préférences restent conservées. La seule modification
d'un champ de carte autorisée est la catégorie d'Igor.

La recette vérifie les cartes du catalogue champ par champ et compare tous les
liens de classeurs non concernés, dont les branches Fate. Elle refuse une nouvelle
distribution du casting Persona ou un favori/widget lié aux anciennes clés anime
absent de l'audit, afin de ne pas perdre une sélection créée entre-temps.
Le changement de version invalide la projection comme les regroupements précédents.

Après application, refaire l'audit ANIME/MANGA et actualiser le rapport local.
