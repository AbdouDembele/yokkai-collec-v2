# Remise à zéro des actifs avant ouverture

Opération manuelle unique, demandée par Abdou : retirer toutes les cartes possédées
et tous les Karas, y compris ceux des administrateurs. Les comptes Auth, profils
et wishlists sont conservés. Ce script n'est ni une migration ni un endpoint.
Il ne s'exécute jamais lors d'un déploiement, d'un import ou d'une ouverture de pack.

`scripts/admin/launch-assets-reset.mjs` exporte un inventaire en lecture seule et
un générateur de transaction SQL. Le mode par défaut termine par `ROLLBACK`.
L'application définit explicitement `commit: true` après la répétition validée.
Le générateur n'ouvre aucune connexion et n'accepte aucun secret.

## Périmètre

- Annuler les enchères actives et leurs dépendances ; leurs Karas immobilisés
  sont également supprimés. Les ventes historiques restent présentes.
- Annuler les offres d'échange en attente ; conserver les échanges historiques.
- Retirer les Decision Packs déjà ouverts mais non terminés, qui permettraient
  de récupérer des cartes ou des Karas issus de la période précédant l'ouverture.
  Conserver les tirages terminés, réserves de boosters non ouverts et calendriers.
- Déverrouiller puis supprimer les instances de `user_cards`, sans modifier le
  catalogue `cards` ni les relations de licences.
- Mettre tous les soldes à zéro et vider les sélections de cartes en vitrine.
  Les bannières liées aux cartes sont retirées, y compris les sélections anciennes
  qui ne correspondent déjà plus à une copie possédée. Les autres bannières restent.
- Conserver intégralement les comptes, wishlists et autres champs de profil,
  notamment les abonnements, options, réserves et calendriers. Les relations
  sociales, publications et historiques hors dépendances des enchères actives
  ne sont pas visés.

## Procédure opérateur

1. Vérifier la branche à jour, la CI verte, le registre réel des migrations et
   l'absence d'autre intervention SQL. N'utiliser qu'une connexion administrative
   sans JWT joueur. Ne jamais placer d'identifiants dans Git ou les arguments.
2. Lire `launchInventorySQL` et garder le manifeste dans un répertoire privé.
   Il contient seulement des compteurs et empreintes, aucun identifiant joueur.
3. Générer `launchAssetsResetSQL(manifest)` et exécuter la répétition. Vérifier
   le résultat annoncé puis le retour de l'inventaire initial après rollback.
4. Pour l'application, conserver une sauvegarde PostgreSQL privée validée avec
   `pg_restore --list` et son SHA-256. L'opérateur de lancement prend cette
   sauvegarde depuis un snapshot exporté **sous les mêmes verrous de tables que
   la remise à zéro**, avant les suppressions. Les écritures concernées attendent
   pendant cette courte fenêtre. Une erreur de sauvegarde impose un rollback.
5. Exécuter exactement le corps répété, avec `commit: true`. Les compteurs et
   empreintes attendus sont revalidés après acquisition des verrous. Tout écart
   annule l'opération ; refaire un inventaire et une répétition, sans supprimer
   ni assouplir cette garde.
6. Vérifier le reçu final : zéro instance, solde, enchère active, offre en attente
   et ancien tirage en attente. Les empreintes des comptes et wishlists doivent
   correspondre et le catalogue rester identique. Les profils sont comparés
   champ par champ aux seuls changements prévus.

Les gardes et triggers restent actifs. Un verrou transactionnel empêche deux
remises à zéro concurrentes. Les attentes de verrous sont limitées à 3 secondes ;
une connexion opérateur abandonnée en transaction expire après 60 secondes.
La frontière est le commit : les acquisitions réalisées ensuite par les joueurs
appartiennent au nouveau départ et ne doivent pas être effacées par une répétition.
Ne pas relancer une remise à zéro déjà réussie sans nouvelle demande explicite.

La sauvegarde ne doit pas être restaurée globalement sur le site ouvert pour
annuler quelques actifs : une restauration complète pourrait écraser de nouveaux
comptes et de nouvelles wishlists. Garder le reçu et traiter une restauration
éventuelle comme une opération séparée.
