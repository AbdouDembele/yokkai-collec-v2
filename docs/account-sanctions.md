# Reçus de décisions administratives

Le journal `account_sanctions` est privé, sans accès direct des rôles API.
Il conserve les décisions et preuves même si un compte est supprimé. Il ne
déclenche ni notification générique, ni push, ni e-mail. Aucun bannissement
n'est ajouté par ce mécanisme.

Les joueurs lisent uniquement leurs propres reçus APPLIED, publiés et non
acquittés. Ils ne peuvent acquitter qu'un identifiant qui leur appartient,
avec un horodatage serveur conservé lors des répétitions. Les preuves,
soldes et identités d'autres joueurs ne sont jamais projetés.

La popup est obligatoire jusqu'à l'acquittement réussi. Une erreur réseau
conserve le reçu. Les décisions multiples sont présentées séparément.
Les textes source anglais et français distinguent retrait de cartes prouvé,
pénalité Kara administrative et avertissement préventif sans retrait.

## Exploitation

La migration `20261031200000_account_sanction_receipts.sql` crée seulement
le journal et les deux RPC de reçus. Elle n'applique aucune sanction.
L'application exige une autorisation distincte avec UUID et preuves exactes.

`scripts/sql/apply-referral-sanctions.sql` n'est pas une fonction API. Le
propriétaire l'exécute dans une transaction avec des tables temporaires de
périmètre contrôlées. Il exige trois décisions distinctes et exactement 75
UUID candidats, retire uniquement les candidats encore chez leur propriétaire
sanctionné, protège ceux transférés et refuse une absence inexpliquée, un
verrou, un échange en attente ou un historique d'enchère sur une carte à retirer.
Les soldes verrouillés déterminent `floor(balance/2)`. Le journal et les
opérations sont atomiques ; les operation_id persistants empêchent les doubles
retraits et un lot partiellement existant provoque un arrêt.

Un verrou de maintenance bref sur les tables économiques et un contrôle
d'absence de transaction concurrente sont requis en production. Un timeout
ou toute précondition critique provoque un ROLLBACK intégral : ne pas relancer
automatiquement. L'opérateur garde une sauvegarde lisible et hachée avant toute
mutation, plus les images avant/après committées dans le journal. Il prépare
un rollback gardé : aucun écrasement de données joueur ayant évolué depuis.

Ordre : snapshot récent, validation du périmètre et de l'autorisation,
sauvegarde validée, application transactionnelle, post-contrôles, puis
publication distincte des reçus. Le frontend ne voit aucun reçu avant
`published_at`. Ne jamais renseigner `notification_seen_at` à la place du joueur.

## Validation et droits

Les nouveaux tests couvrent les rôles, la projection privée, les acquittements
croisés, la répétition, les entiers pairs/impairs, l'atomicité et les tiers.
L'ajout des deux surcharges exactes à l'allowlist des droits SQL a été
explicitement validé par Walid. Aucune assertion existante n'est retirée.
