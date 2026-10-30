# Normalisation manuelle des licences ANIME/MANGA — V5

La nouvelle phase repose sur le classeur de 2 604 licences. Ses noms et ses effectifs par rareté correspondent à la production. Toute licence hors des décisions manuelles reste inchangée ; aucune ancienne suppression V4 n'est rejouée.

Après une première préparation en lecture seule, Abdou a expressément demandé l'application directe en production. La sauvegarde complète V5 a été restaurée dans un conteneur isolé avant l'application. Les regroupements, leurs pages de cartes et le retour arrière sélectif ont été vérifiés sur ce clone.

## Résultat de production

| Cible MERGE        | Sources de l'audit | Cartes distinctes conservées |
| ------------------ | -----------------: | ---------------------------: |
| PreCure            |                 13 |                          664 |
| Ghost in the Shell |                  3 |                          133 |
| Lupin III          |                  3 |                          377 |
| Baki               |                  2 |                           72 |
| Gundam             |                 12 |                          468 |
| Digimon            |                  7 |                          336 |

Les 2 050 cartes des regroupements sont conservées ; leurs exemplaires possédés ne sont pas modifiés par la transaction. Les associations physiques d'origine restent disponibles comme provenance.

Les DELETE portent uniquement sur les autres Gundam explicitement visés, les deux Digimon nommés, les six Macross et les deux sources Code Geass désignées. Résultat : 725 cartes catalogue et 389 exemplaires supprimés. Le catalogue passe de 2 604 à 2 544 licences. Les 2 537 licences non sélectionnées restent inchangées.

Le classeur Akito contenait aussi deux cartes de The Wyvern Divided. Elles sont conservées : le DELETE vise les 21 cartes de la source physique exacte The Wyvern Arrives, sans élargissement au parent. Le principal Code Geass et les autres associations restent intacts. Le nom historique du classeur peut rester affiché pour ces deux cartes préservées.

## Protections et contrôles

- Ensembles d'UUID déterministes ; aucune intersection MERGE/DELETE. KEEP/MERGE prioritaire sur DELETE.
- Gardes sur les séquestres, les choix de packs et les nouvelles associations hors périmètre, recalculées sous verrou.
- Comparaison complète des cartes, possessions et associations non concernées avant/après ; aucun compte, profil ou objet Storage supprimé.
- Historiques d'échanges terminés conservés ; aucune enchère active cassée. Aucun pack bloquant dans ce lot.
- Les anciennes clés et alias de source redirigent vers les six cibles. Les vraies pages de cartes ont été testées, y compris les sources déjà regroupées avant V5.
- Sauvegarde restaurée réellement avec les compteurs du même snapshot ; rollback répété avec les empreintes exactes des 19 tables restaurées.
- Journal privé par clé primaire et colonnes modifiées ; redirections existantes restaurées avant suppression des nouveaux groupes lors du rollback.
- Schéma sans divergence ; principales routes HTTP 200 et conteneur sain après application. Aucun nouveau PostgreSQL ERROR ni HTTP 5xx détecté dans les journaux consultés.

## Périmètre de cette PR et migrations

Documentation uniquement. La normalisation est une opération de données éditoriales utilisant le support déjà livré par la PR #17 : aucune nouvelle migration et aucun changement de code applicatif. Les 258 migrations du VPS restent inchangées.

L'opération V5 est déjà appliquée en production. Les scripts, manifeste détaillé, UUID, possessions, journaux et sauvegardes restent privés hors Git ; cette PR n'inclut aucun script destructif ni identifiant de production.

Les PR #15 des classeurs et #16 de l'audit précédent restent séparées.
