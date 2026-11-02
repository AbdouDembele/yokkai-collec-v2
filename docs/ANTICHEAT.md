# Anti-triche en mode observation

Le dispositif anti-triche journalise les événements économiques sensibles et
les présente aux administrateurs sous forme de signaux explicables. Il ne
bannit, ne sanctionne et ne retire jamais automatiquement des cartes ou des
Karas.

## Événements observés

- création d'un compte ;
- création, acceptation, refus et annulation d'un échange ;
- création, enchère, vente et expiration d'une enchère ;
- attribution d'une récompense de parrainage.
- association temporaire de comptes à une même identité réseau pseudonyme ;
- échange accepté entre des comptes liés par une identité réseau récente.

Le journal et ses associations sont privés, sans politique de lecture, et
protégés contre les mises à jour et suppressions. Les administrateurs passent
uniquement par deux fonctions DTO bornées qui revérifient leur rôle.

## Signaux explicables

- échange à sens unique ;
- écart important entre les valeurs pondérées des deux lots ;
- transfert d'au moins 5 000 Karas ;
- échanges acceptés répétés entre les mêmes comptes en 24 heures ;
- enchère extrême ou activité répétée entre l'enchérisseur et le vendeur ;
- ventes répétées entre les mêmes comptes sur sept jours ;
- rafale de récompenses de parrainage ;
- activité économique d'un compte créé depuis moins de 72 heures.
- identité réseau partagée (signal faible et contextuel) ;
- échange entre des comptes liés par une identité réseau récente.

Chaque événement conserve ses codes de raison et ses points. Le score sert à
prioriser la revue humaine, pas à établir seul une fraude.

## Historique et exploitation

La migration importe de manière bornée les échanges acceptés, ventes et
parrainages des 90 derniers jours et les enchères des 30 derniers jours. Les
nouveaux événements sont ensuite ajoutés par des déclencheurs de base de
données, ce qui évite de dépendre du navigateur.

Le tableau `/admin/security` permet de filtrer les dossiers par pseudo,
adresse e-mail et sévérité, puis de consulter le journal récent par joueur ou
type d'événement. Chaque administrateur peut consigner une note immuable et
marquer le dossier ouvert, examiné ou écarté. Un nouveau signal rouvre le
dossier. Les sanctions éventuelles restent réalisées avec les outils de
modération existants après vérification.

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
