# Anti-triche en mode observation

Le dispositif anti-triche journalise les événements économiques sensibles et
les présente aux administrateurs sous forme de signaux explicables. Il ne
bannit, ne sanctionne et ne retire jamais automatiquement des cartes ou des
Karas.

## Événements observés

- création d'un compte ;
- création, acceptation, refus et annulation d'un échange ;
- création, enchère, vente et expiration d'une enchère ;
- attribution d'une récompense de parrainage ;
- association temporaire de comptes à une même identité réseau pseudonyme ;
- échange accepté entre des comptes liés par une identité réseau récente.

Le journal et ses associations sont privés, sans politique de lecture, et
protégés contre les mises à jour et suppressions. Les administrateurs passent
uniquement par deux fonctions DTO bornées qui revérifient leur rôle.

## Signaux explicables

- échange à sens unique ;
- écart important entre les valeurs pondérées des deux lots ;
- transfert d'au moins 5 000 Karas ;
- enchère extrême ;
- rafale de récompenses de parrainage ;
- activité économique d'un compte créé depuis moins de 72 heures ;
- identité réseau partagée (signal faible et contextuel) ;
- échange entre des comptes liés par une identité réseau récente.

Les volumes répétés d'échanges, d'enchères et de ventes restent dans le journal
comme contexte, mais ne donnent plus de points à eux seuls. Jouer beaucoup ne
constitue donc pas un signal de risque.

Chaque événement conserve ses codes de raison et ses points historiques. Le
score affiché aux administrateurs est cependant recalculé sur les 30 derniers
jours, ou depuis la dernière décision « écarté » si elle est plus récente. Les
raisons actives sont plafonnées séparément afin qu'une même activité répétée ne
puisse pas faire croître indéfiniment le score :

| Signal                                   | Points par occurrence | Plafond actif |
| ---------------------------------------- | --------------------: | ------------: |
| Source d'un échange à sens unique        |                     3 |             6 |
| Bénéficiaire d'un échange à sens unique  |                    12 |            24 |
| Fort déséquilibre de valeur              |                     6 |            18 |
| Transfert d'au moins 5 000 Karas         |                     5 |            15 |
| Enchère extrême                          |                     8 |            16 |
| Rafale de parrainages                    |                    10 |            20 |
| Activité économique d'un nouveau compte  |                     8 |            16 |
| Identité réseau partagée                 |                     3 |             9 |
| Échange entre comptes liés par le réseau |                    20 |            60 |

Les sévérités actives sont « à surveiller » sous 20 points, « élevée » à
partir de 20, « haute » à partir de 40 et « critique » à partir de 80. Le score
sert à prioriser la revue humaine, pas à établir seul une fraude.

## Historique et exploitation

La migration importe de manière bornée les échanges acceptés, ventes et
parrainages des 90 derniers jours et les enchères des 30 derniers jours. Les
nouveaux événements sont ensuite ajoutés par des déclencheurs de base de
données, ce qui évite de dépendre du navigateur.

Le tableau `/admin/security` permet de filtrer les dossiers par pseudo,
adresse e-mail et sévérité, puis de consulter le journal récent par joueur ou
type d'événement. Chaque administrateur peut consigner une note immuable et
marquer le dossier ouvert, examiné ou écarté. Une décision « écarté » remet le
score actif à zéro ; seul un nouveau signal pondéré peut rouvrir le dossier.
Les dossiers ouverts dont les anciens points provenaient uniquement du volume
ne sont plus présentés comme dossiers à risque. Les sanctions éventuelles
restent réalisées avec les outils de modération existants après vérification.

Les cinq tables sont recensées dans `docs/data-export-inventory.json` pour
une revue manuelle des demandes d'accès impliquant ces éléments de sécurité
et les données de contreparties. Elles ne sont pas ajoutées aux téléchargements
automatiques des joueurs.

## Corrélation réseau pseudonyme

L'origine VPS est fermée au trafic web direct et la chaîne Cloudflare/Traefik
supprime les en-têtes fournis par le navigateur. Une route serveur vérifie la
session puis transmet à Supabase uniquement le HMAC versionné produit par le
proxy. La fonction d'écriture est réservée au `service_role` : un joueur ne peut
pas fabriquer une association par RPC.

La table de rapprochement ne conserve jamais l'adresse brute. Ses observations
sont purgées après sept jours et une même association n'est rafraîchie qu'une
fois toutes les quinze minutes. Le tableau admin expose uniquement le nombre de
comptes rapprochés, jamais le HMAC. Une IP partagée (foyer, école, opérateur ou
VPN) n'est pas une preuve de fraude : le signal seul ne déclenche aucune
sanction automatique.
