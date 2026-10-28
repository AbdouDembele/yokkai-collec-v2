# Correction des compteurs et remise à zéro des succès du lancement

Opération unique demandée après le reset des actifs (#535). Les ouvertures faites
depuis ce reset doivent rester comptées. Le reset des succès de tous les joueurs
est explicitement demandé aussi. Ne jamais relancer le reset des cartes/Karas.

La sauvegarde validée de #535 a été prise dans le snapshot exporté sous les verrous
du reset. Extraire uniquement les cinq compteurs de `user_achievement_stats` et,
par joueur, les nombres de Decision Packs ouverts et **claimed** conservés. Les cinq anciens
tirages pending ont été supprimés par #535 et ne doivent pas être soustraits.
Les identifiants des joueurs et le manifeste restent privés, hors Git.

`scripts/admin/reset-launch-progress.mjs` génère la transaction opérateur. Il
soustrait la référence aux compteurs actuels sous verrou, sans figer les nouvelles
ouvertures à l'heure de l'audit. Les nouveaux comptes gardent leurs compteurs.
Un compteur inférieur à sa référence annule toute l'opération, sans écrêtage.

La migration `20261026220000_profile_decision_pack_reset_offset.sql` ajoute un
décalage privé aux statistiques existantes et l'applique au compteur du profil.
Elle ne peuple aucune référence : un déploiement seul ne remet rien à zéro.
L'historique des Decision Packs reste intact, les prochains tirages augmentent
normalement le total, et la confidentialité du profil reste inchangée.

Le reset des succès supprime tous les états complétés/réclamés et leurs
notifications, y compris pour les administrateurs. La progression issue des
actions depuis le lancement reste présente. Les événements suivants passent par
le mécanisme normal de validation des succès. Les récompenses déjà versées ne
sont pas retirées ; aucune récompense n'est versée par ce script.
Les dix premiers Regular Packs du nouveau compteur suivent la règle produit
existante des nouveaux joueurs ; cette règle n'est pas modifiée.

Le délai Decision Pack est aussi annulé pour les joueurs qui en avaient ouvert
avant le lancement et n'en ont ouvert aucun depuis. Un joueur qui a déjà ouvert
son pack de lancement conserve son délai et ses choix en attente. Cette condition
est revérifiée sous verrou au moment de l'application. Les packs déjà disponibles
restent disponibles, sans bonus supplémentaire ni changement de cadence Pro.

Avant application : CI GitHub verte sur la branche à jour, registre et schéma
réels vérifiés, sauvegarde privée validée. Appliquer migration, recette et entrée
de registre atomiquement. Tous les comptes, profils (dont Karas et réserves),
cartes possédées, wishlists et historiques Decision sont comparés avant/après.
Les profils ne peuvent changer que leur délai Decision pour les joueurs concernés.
Les triggers et droits joueurs restent actifs. Le mode par défaut est un
rollback ; `commit: true` est réservé à l'application autorisée. Le décalage
non nul bloque une répétition de cette opération de lancement.
