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

Chaque événement conserve ses codes de raison et ses points. Le score sert à
prioriser la revue humaine, pas à établir seul une fraude.

## Historique et exploitation

La migration importe de manière bornée les échanges acceptés, ventes et
parrainages des 90 derniers jours et les enchères des 30 derniers jours. Les
nouveaux événements sont ensuite ajoutés par des déclencheurs de base de
données, ce qui évite de dépendre du navigateur.

Le tableau `/admin/security` permet de filtrer les dossiers par pseudo,
adresse e-mail et sévérité, puis de consulter le journal récent par joueur ou
type d'événement. Les sanctions éventuelles restent réalisées avec les outils
de modération existants après vérification.

Les trois tables sont recensées dans `docs/data-export-inventory.json` pour
une revue manuelle des demandes d'accès impliquant ces éléments de sécurité
et les données de contreparties. Elles ne sont pas ajoutées aux téléchargements
automatiques des joueurs.

## Corrélation IP non activée

L'adresse IP n'est pas enregistrée à ce stade. `docs/AUTH-HARDENING.md`
documente que l'origine VPS doit d'abord être fermée au trafic direct et que
la chaîne de proxy doit réécrire les en-têtes d'adresse de manière fiable.
Avant cela, une valeur transmise par le client pourrait être falsifiée et
produire de faux rapprochements. La corrélation IP ne devra être ajoutée
qu'après ce durcissement, avec rétention courte, hachage et accès admin borné.
