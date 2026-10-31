# Maintenance économique contrôlée

Migration `20261031210000_economic_maintenance.sql`, désactivée par défaut.

Les triggers de statement refusent les écritures sur les cartes, enchères,
offres, mises, Decision Packs et colonnes économiques des profils. Ils couvrent
RPC, PostgREST, service role et tâches cron ; les lectures et la présence restent
disponibles. Une erreur stable `ECONOMIC_MAINTENANCE` ne révèle aucune opération
administrative. Seul le booléen actif est consultable ; le contexte opérateur
reste privé. Aucun nouveau droit SECURITY DEFINER n'est ajouté.

## Procédure propriétaire

1. Enregistrer et committer `active=true`, `started_at=clock_timestamp()`, version,
   opérateur et raison interne dans l'unique ligne.
2. Sur une connexion PostgreSQL propriétaire dédiée, attendre au maximum 30 s
   `pg_advisory_lock(710031,2100)` ; les écritures déjà admises détiennent le verrou
   partagé jusqu'à la fin naturelle de leur transaction. Ne tuer aucun backend.
3. Conserver cette connexion pendant la fenêtre : le verrou exclusif refuse
   aussi une écriture issue d'un ancien snapshot. Vérifier les transactions et
   verrous économiques avant de déclarer le drain terminé.
4. Faire le snapshot cohérent et la sauvegarde vérifiée. Aucun verrou de ligne
   joueur n'est détenu pendant cette étape.
5. Dans la transaction d'APPLY courte seulement, une connexion dont **session_user
   est postgres** peut utiliser `SET LOCAL yokkai.economic_operator='on'`.
   Ne pas utiliser `admin_set_user_ban` si les actifs doivent rester intacts :
   cette ancienne fonction annule les enchères et rembourse des mises.
6. Vérifier le COMMIT ou le rollback, publier les reçus réels, puis committer
   `active=false, ended_at=clock_timestamp()` et libérer le verrou de session.
7. Vérifier les mutations avec des transactions annulées et contrôler le flag.

La perte de connexion libère le verrou mais **ne retire pas le flag** : les
mutations restent refusées jusqu'à une vérification opérateur explicite.
Un timeout de drain impose l'arrêt et une réouverture après contrôle de cohérence.
Ne pas réessayer automatiquement une transaction administrative échouée.

Le lot privé de comptes et cartes n'est jamais livré dans Git. Les suspensions
Auth, révocations de sessions et sanctions peuvent être dans la même transaction
PostgreSQL ; chaque résultat secondaire et son operation_id sont archivés dans
les métadonnées privées du reçu de son parrain. Les comptes et leur historique
ne sont pas supprimés. Les jetons de rafraîchissement révoqués ne sont pas
réactivés automatiquement lors d'une éventuelle restauration de sanction.
