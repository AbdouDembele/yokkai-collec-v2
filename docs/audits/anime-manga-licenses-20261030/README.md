# Audit du tri des licences ANIME/MANGA — en attente

Le tri Excel a été contrôlé en lecture seule sur le schéma réel de production. Le lot reste en STOP, sans application partielle.

## Décisions reçues

- 1 805 lignes : 80 KEEP, 136 MERGE, 1 589 DELETE.
- Aucune décision inconnue, licence dupliquée, cible de MERGE vide, autofusion, chaîne ou cycle.
- Les noms et les cibles du fichier sont la source de vérité ; aucune correspondance approximative n'autorise une opération.

## Blocages constatés

- 139 sources n'ont pas de correspondance exacte parmi les noms des classeurs ANIME/MANGA actuels.
- 89 lignes MERGE ont une cible non résolue sous le nom exact fourni.
- Le retrait des associations DELETE reconnues laisserait 8 712 cartes sans classeur. Ce nombre a été recoupé par deux calculs indépendants.
- Le modèle combine associations textuelles, franchise principale et identités de classeurs calculées. Effacer simplement l'une de ces représentations ne garantit pas un catalogue cohérent.

## Mesures prises

Aucune carte, possession, image, association, préférence, donnée historique ou identité de licence n'est modifiée. Aucun nettoyage Storage, aucune migration, aucun déploiement et aucune application partielle ne sont inclus.

Une sauvegarde ciblée a été créée sur le VPS, avec index et lecture/décompression complète validés. Une restauration SQL réelle n'a pas été répétée ; le plan n'est pas déclaré exécutable.

## Rapports détaillés locaux

Les rapports RAPPORT-LICENCES-DRY-RUN.md et RAPPORT-LICENCES-CLEANUP.md, ainsi que les listes de correspondances, anomalies, opérations différées et cartes à décision manuelle, restent dans le dossier local ignoré .tools/license-cleanup-full-reports. Leurs détails de production ne sont pas publiés dans cette PR.

Les captures de schéma, compteurs horodatés, empreintes et manifeste de sauvegarde restent également hors Git. Le fichier Excel original n'est pas modifié.

## Reprendre

Résoudre explicitement les noms et cibles manquants, puis définir le traitement des cartes qui perdraient leur classeur sans supprimer les cartes elles-mêmes. Refaire le dry-run sur l'état réel, préparer les opérations par IDs avec assertions, valider le rollback et coordonner toute intervention SQL avant d'appliquer quoi que ce soit.

La PR #15 des fonctionnalités de classeurs reste séparée, en brouillon et sans déploiement. Cette PR de synthèse ne modifie que la documentation ; elle n'autorise aucune opération de nettoyage.

## Évolution du périmètre demandée après le premier audit

L'utilisateur a précisé que DELETE doit viser les cartes du catalogue et a explicitement inclus leurs exemplaires possédés et leurs dépendances. Les images et Storage restent exclus. Cette précision remplace la protection initiale de tous les exemplaires ; les décisions KEEP/MERGE de l'Excel restent à respecter.

Un audit V2 et une copie révisée de l'Excel sont conservés localement hors Git. Les associations textuelles exactes permettent de retrouver la plupart des noms précédemment absents sans élargir la suppression au classeur parent. Des sources/cibles restent non résolues et certaines cartes croisent KEEP et DELETE. Le nouveau périmètre touche aussi des transactions et récompenses en attente : leur traitement doit être défini avant suppression.

L'ancienne sauvegarde ciblée des licences ne suffit pas pour ce périmètre élargi. Prévoir une sauvegarde cohérente de toutes les données concernées et une restauration répétée dans un environnement isolé. Aucun SQL de suppression n'est déclaré exécutable et aucune opération n'est appliquée à la production.
