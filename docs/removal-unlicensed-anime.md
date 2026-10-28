# Suppression des cartes anime sans licence — 15 octobre 2026

L’utilisateur a validé la suppression des 15 406 cartes du CSV audité, puis confirmé explicitement le retrait des exemplaires possédés et de l’entrée de wishlist associée. Il s’agit des cartes sans licence, même si leur image est présente. Aucune autre catégorie n’est concernée.

Migration : `20261015000003_remove_audited_unlicensed_anime.sql`, **non appliquée sur le VPS lors de la préparation de la PR**.

## Périmètre fermé

- Source `anilist`, catégorie normalisée `ANIME/MANGA`, franchise primaire vide et aucune entrée dans `card_franchises`.
- Nombre attendu : 15 406 ; empreinte MD5 des UUID triés et joints par une virgule : `1b864d9b640237d59ee73772b348115d`.
- Si le nombre ou l’empreinte diffère, la transaction échoue avant toute suppression. Une base vide et un rejeu sans candidats sont des no-ops.
- Les lignes du catalogue puis leurs exemplaires sont verrouillés. Une enchère active sur ces exemplaires fait échouer toute l’opération : aucun remboursement ou changement de solde implicite.
- Nettoyage des échanges en attente, bannières, vitrines, partages, choix de boosters et exemplaires ciblés selon les mécanismes existants. Les historiques d’enchères terminées sont conservés avec leur référence d’exemplaire détachée. Les wishlists et liens de catalogue suivent leurs FK existantes.
- Aucun fichier ni objet Storage n’est supprimé ; aucun privilège SQL n’est modifié.

## Avant application

Coordination avec Walid confirmée par l’utilisateur. Vérifier le registre réel, l’empreinte et les enchères ; utiliser `scripts/deploy-migrations.sh` avec sa sauvegarde VPS complète validée et sa transaction unique. La liste auditée et les images conservées permettent d’organiser une restauration ciblée à partir de la sauvegarde ; ne pas restaurer toute la production sans procédure séparée.

L’audit préalable comptait 2 082 exemplaires chez 46 joueurs, une entrée de wishlist, aucune enchère active et aucun choix de booster. Les totaux définitifs sont à vérifier au moment de l’application.

## Tests

`tests/remove-audited-unlicensed-anime-db.test.mjs` vérifie les garde-fous de production, le nettoyage des dépendances, les copies verrouillées, la conservation des autres catégories/licences et du Storage, l’absence de mouvement des soldes, l’idempotence et le refus d’une enchère active. Pour le scénario positif, seules les deux constantes de l’audit sont injectées avec les UUID synthétiques de la fixture ; le SQL de sélection et de suppression reste identique. La migration originale non modifiée est vérifiée séparément pour son refus d’un jeu de cartes différent.

Aucun test existant n’est supprimé ou assoupli. La CI complète reste exécutée exclusivement par GitHub Actions avant merge.
