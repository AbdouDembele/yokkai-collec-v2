# Classements des profils et des licences — essais locaux

Deux onglets supplémentaires dans /leaderboard et /social/leaderboard : les profils les plus aimés et la progression des licences, globale ou par licence. Les classements Collection et Parrainages restent disponibles. EN/FR intégrés ; avatars, cadres et pseudos personnalisés suivent les droits Pro existants.

## Règles de calcul

- Profils : nombre actuel de J’aime reçus sur le profil, identique au total du profil. La contrainte existante autorise un seul J’aime par joueur et interdit l’auto-like. Les publications ne comptent pas. Aucun détail sur les personnes ayant aimé n’est renvoyé.
- Licences : choix d’un classeur dans le catalogue courant, avec recherche et pages de 24 licences. Classement des joueurs par cartes distinctes actuellement possédées dans ce classeur. Les variantes et les doublons d’un même identifiant ne comptent qu’une fois ; une carte transférée ou supprimée cesse de contribuer. Le total reprend exactement les licences secondaires, les identités stables par catégorie et les fusions validées des classeurs. Le mode historique par nom exact reste compatible.
- Pour une même licence, le dénominateur est identique pour tous les joueurs : les classeurs terminés arrivent avant les progressions partielles. Par exemple, 4/4 précède 3/4 ; 5 exemplaires de la même carte valent toujours une seule carte distincte. Les pourcentages affichés ne s’arrondissent jamais à 100 % avant la dernière carte.
- Les égalités partagent un rang de compétition, par exemple 1, 2, 2, 4. Les pseudos départagent uniquement l’ordre d’affichage.

## Classement global des licences

L’onglet Licences s’ouvre sur le nombre de **licences terminées**, tous classeurs et catégories confondus. Un second tri classe les joueurs par **cartes distinctes possédées dans tout le catalogue**. La vue **Par licence** conserve le sélecteur et sa recherche ; la licence choisie reste sélectionnée après un aller-retour dans la vue globale.

Les deux tris affichent les deux compteurs de chaque joueur. Le dénominateur vient du catalogue courant, sans valeur 90 000 codée en dur : recette locale du 30 octobre 2026, 82 557 cartes et 2 738 classeurs. Une identité de carte ne compte qu’une fois, y compris avec des variantes ou plusieurs associations de licence. En revanche, cette carte peut participer à plusieurs classeurs réellement distincts. Les classeurs fusionnés sont comptés une seule fois, et les classeurs vides ne sont pas considérés terminés.

Le classement par licences terminées inclut aussi les joueurs qui ont commencé une collection sans avoir fini de licence. Les ex æquo conservent un même rang ; le nombre de cartes distinctes, puis le pseudo et l’identifiant, stabilisent leur affichage. Le tri par cartes distinctes est indépendant du score pondéré de l’onglet Collection existant.

Migration supplémentaire : **20261030220000_global_license_leaderboard.sql**, appliquée uniquement à Kara, pas au VPS. Elle étend le lecteur de licences existant, avec les sélecteurs réservés global:completed et global:cards (et leurs variantes :legacy lorsque les classeurs historiques sont activés). Elle ne crée aucune nouvelle signature ni autorisation. Les règles d’authentification, de confidentialité, de blocage, de recherche, d’amis et de pagination restent identiques. Le lecteur par licence reste inchangé.

Le nouveau test global-license-rankings-db vérifie notamment la différence entre les deux tris, les totaux du catalogue, les fusions avec cartes partagées, les licences secondaires et homonymes, les variantes, la perte de cartes, les profils privés et les accès refusés. Aucun test existant ni liste de droits n’est modifié pour cette extension. Le retour arrière restaure la définition précédente du lecteur, sans mutation des données métier.

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

Recette globale additionnelle : vrais compteurs locaux, passage entre les deux tris et une licence, conservation du choix, recherche de joueur, filtre Amis et vue Social, en EN/FR de 320 à 1440 px. Le zoom natif à 200 % reste non vérifié.

Dans la vue Licences terminées, le résumé personnel et chaque ligne indiquent le nombre de licences terminées sur le total des licences du site. Le compteur de cartes reste réservé à la vue Cartes distinctes. Aucun calcul SQL ne change.

La vue Par licence propose une catégorie avant la recherche et le choix de licence. Les catégories viennent des métadonnées du catalogue existant ; le filtrage est effectué par le lecteur borné de classeurs, avant pagination. Un changement de catégorie remet la recherche et la page à zéro et efface la sélection précédente ; seules les licences de la nouvelle catégorie sont proposées. Les vues globales restent sur tout le site. Aucune migration supplémentaire.
