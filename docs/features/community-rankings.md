# Classements des profils et des licences — essais locaux

Deux onglets supplémentaires dans /leaderboard et /social/leaderboard : les profils les plus aimés et la progression par licence. Les classements Collection et Parrainages restent disponibles. EN/FR intégrés ; avatars, cadres et pseudos personnalisés suivent les droits Pro existants.

## Règles de calcul

- Profils : nombre actuel de J’aime reçus sur le profil, identique au total du profil. La contrainte existante autorise un seul J’aime par joueur et interdit l’auto-like. Les publications ne comptent pas. Aucun détail sur les personnes ayant aimé n’est renvoyé.
- Licences : choix d’un classeur dans le catalogue courant, avec recherche et pages de 24 licences. Classement des joueurs par cartes distinctes actuellement possédées dans ce classeur. Les variantes et les doublons d’un même identifiant ne comptent qu’une fois ; une carte transférée ou supprimée cesse de contribuer. Le total reprend exactement les licences secondaires, les identités stables par catégorie et les fusions validées des classeurs. Le mode historique par nom exact reste compatible.
- Pour une même licence, le dénominateur est identique pour tous les joueurs : les classeurs terminés arrivent avant les progressions partielles. Par exemple, 4/4 précède 3/4 ; 5 exemplaires de la même carte valent toujours une seule carte distincte. Les pourcentages affichés ne s’arrondissent jamais à 100 % avant la dernière carte.
- Les égalités partagent un rang de compétition, par exemple 1, 2, 2, 4. Les pseudos départagent uniquement l’ordre d’affichage.

## Visibilité et lecture bornée

Seuls les profils publics et actifs sont classés. Les comptes bannis, supprimés et les blocages bilatéraux sont filtrés. Un joueur privé voit uniquement son propre total dans son encadré personnel, sans apparaître dans la liste. Le filtre Amis exige une relation acceptée ; il conserve les rangs globaux.

Top 100 par défaut, recherche littérale de pseudo au-delà du top 100, pages de 20 joueurs (plafond serveur 100). Les styles sont calculés uniquement pour la page autorisée. Aucun droit de lecture directe sur les likes, les associations du catalogue ou les possessions privées n’est ajouté. Les réponses périmées sont ignorées lors d’un changement d’onglet, de filtre ou de licence.

## Migration et validation des droits

20261030210000_social_license_leaderboards.sql crée deux fonctions de lecture : get_profile_likes_leaderboard(integer,integer,text,boolean) et get_license_leaderboard(text,integer,integer,text,boolean). Accès authenticated uniquement, session et compte actif exigés, search_path vide ; ni anon ni service_role ne peuvent les appeler. Aucun transfert, récompense, drop ou paramètre de confidentialité ne change.

**Appliquée uniquement à Kara en local ; pas au VPS.** Les autres migrations de la PR Classeurs restent également locales. Le retour arrière consiste à supprimer ces deux fonctions et leur entrée de journal, sans modification de données métier. Ne pas appliquer en production sans la coordination SQL habituelle et les checks GitHub verts.

Walid a explicitement validé l’ajout de ces deux signatures à tests/security-definer-allowlist.mjs. Aucun contrôle existant n’est retiré ni assoupli. Le nouveau test community-rankings-db couvre les calculs, les ex æquo, les doublons/variantes, licences secondaires et homonymes, fusions, transferts, unlikes, recherche, pagination, amis, profils privés, blocages, bannissements, suppression et privilèges.

## Recette

Parcours connecté local avec le compte abdou : les fonctions réelles et la licence Dragon Ball (253 cartes) sont contrôlées. Les états de pagination, recherche, liste vide, amis et réponses tardives sont aussi vérifiés avec des réponses synthétiques interceptées seulement dans le navigateur de recette, sans créer de faux likes ou joueurs en base.

Mise en page FR/EN contrôlée à 320, 375, 600, 768, 1024, 1280 et 1440 px. La largeur 720 px simule une fenêtre réduite ; le zoom natif à 200 % reste non vérifié. La CI complète reste réservée à GitHub Actions avant toute livraison.
