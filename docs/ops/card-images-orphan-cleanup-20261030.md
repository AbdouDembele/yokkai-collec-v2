# Nettoyage des images de cartes orphelines — 30 octobre 2026

## Périmètre

À la demande du propriétaire du projet, retirer du Storage de production les images dont la carte n'existe plus dans le catalogue après les nettoyages de licences. Cette opération est distincte des suppressions de cartes et ne modifie aucune donnée de jeu.

Le traitement concerne exclusivement le bucket `card-images`. Les avatars et les médias des murs restent hors périmètre.

## Sélection et protections

- Inventaire figé des objets et de leurs versions, tailles, dates et empreintes.
- Protection des images référencées dans toutes les colonnes texte, JSON et tableaux des tables publiques, ainsi que des images citées dans les fichiers de l'application.
- Protection de toutes les variantes d'image rattachables à l'identité d'une carte encore en base, même lorsque cette variante n'est plus l'image actuellement affichée.
- Conservation des objets modifiés depuis moins de 24 heures et des noms non reconnus.
- Nouvelle lecture des références, propriétaires et métadonnées avant chaque lot ; arrêt si un déploiement change l'image de l'application.

Les journaux privés de sauvegarde des cartes supprimées ne sont pas des références actives de l'application. Leurs images sont sauvegardées séparément avant le nettoyage.

## Exécution et récupération

Les fichiers originaux sont copiés dans une sauvegarde privée sur le VPS. Chaque copie est contrôlée par sa taille, son ETag MD5 lorsqu'il est disponible, puis son SHA-256 relu sur disque.

La suppression passe exclusivement par l'API Storage, par lots de 500 chemins exacts. Aucune suppression SQL des métadonnées Storage ni manipulation directe des fichiers du moteur objet n'est utilisée.

Le journal durable contient les intentions, les suppressions confirmées, les éventuels fichiers conservés et les restaurations. Si une référence concurrente apparaît après une suppression, le fichier sauvegardé est restauré par l'API sans écraser un objet plus récent.

Les manifestes détaillés, chemins d'objets, fichiers binaires et journaux restent privés. Ce document ne contient aucun secret ni donnée de joueur.

## Migrations et application

Aucune migration Supabase, modification de droits, modification de test ou mise à jour de code applicatif. La maintenance s'applique directement au Storage déjà en production ; cette PR en conserve le compte rendu.

La sauvegarde conservée sur le VPS signifie que le volume retiré du Storage actif ne correspond pas nécessairement à un gain net identique sur le disque du serveur.

## Résultat en production

- **29 309 images supprimées**, soit 2 029 728 946 octets (environ 2,03 Go) retirés du Storage actif.
- **29 309 fichiers sauvegardés et vérifiés** avant la première suppression.
- **129 422 objets conservés**, tous retrouvés avec le même identifiant et la même version après l'opération.
- 129 422 objets restent dans le bucket après le nettoyage.
- 0 objet écarté pendant l'exécution ; 0 restauration concurrente nécessaire.
- 114 colonnes publiques contrôlées pour les références ; les 82 556 cartes du catalogue restent présentes.
- Avatars et médias des murs conservés. Téléchargements des images protégées et absence des objets supprimés contrôlés sur l'API interne ; application saine et pages de connexion des deux domaines accessibles.

Aucune mise à jour applicative n'a été déployée pour cette maintenance. Les preuves détaillées et les sauvegardes restent privées.
