# Statuts des comptes et sanctions déjà appliquées

Le parcours admin affiche séparément le statut du compte et les récupérations
déjà effectuées. Un reçu de sanction produit un badge rouge « Sanction déjà
appliquée » ; le statut d’examen du dossier et son score ne sont pas modifiés.

- Liste des dossiers : badge de sanction et bannissement courant.
- Comptes partageant une connexion : identité archivée disponible pendant ses
  90 jours, statut de suppression/bannissement, sanction concernant cette paire.
- Historique des comptes supprimés : même statut et explication visible de la
  case désactivée si tous les transferts traçables ont déjà été traités.
- Journal des échanges réussis : badge de sanction lié au transfert précis,
  statuts de ses participants et détail des cartes/Karas conservé.

Un compte banni reste distinct d’un compte supprimé. Un bannissement actif
avant suppression est conservé et présenté comme tel, même si le joueur
supprime ensuite son compte. Les anciens bannissements sont rapprochés de la
dernière action ban/unban enregistrée avant suppression. On ne déduit jamais
une suppression volontaire d’une simple disparition du compte Auth.

L’origine des suppressions historiques reste « origine non tracée ». Pour les
nouvelles demandes faites depuis les paramètres, l’action serveur valide la
session récente, l’identité Auth et la confirmation du pseudo avant d’appeler
le nouvel accès serveur. Une suppression technique ou la reprise d’un ancien
dossier de suppression ne peut pas réécrire cette origine comme volontaire.

## Migration et droits

`20261103170000_anticheat_account_status.sql` ajoute deux colonnes privées,
enrichit les lecteurs admin existants et ajoute uniquement
`begin_self_requested_account_deletion(uuid)` au rôle `service_role`.
Les helpers de projection n’ont aucun droit d’exécution API. Les contrôles
admin, les limites, la pagination, la conservation des identités et les règles
de récupération restent conservés. Aucune nouvelle sanction n’est appliquée
par cette migration et aucun reçu ni verrou anti-double retrait n’est supprimé.

Walid a validé l’ajout exact à `tests/security-definer-allowlist.mjs` dans le
chat. Aucun test existant n’est supprimé ou assoupli. L’équipe a confirmé être
prévenue sur Discord et qu’aucune autre intervention SQL n’est en cours.

La PR doit préciser l’état d’application réel de la migration au déploiement.

## Vérifications

Tests dédiés : origine volontaire/non tracée, ban/unban avant suppression,
sanction d’un transfert sans marquer les autres comme traités, droits SQL,
identités expirées et refus d’un second retrait. Les tests existants des
sanctions, de la suppression, des données exportées et de leurs droits sont
conservés. Les badges et les cases désactivées sont vérifiés en EN/FR.

La simulation locale utilise les composants réels, sans compte ni sanction de
production : `/design-system/admin-account-status-preview`. Vérification Chrome
à 320, 375, 768, 1024 et 1440 px, plus 1024 et 1440 au zoom 200 %, dans les deux
langues. Cette route est bloquée en production comme les autres simulations.
