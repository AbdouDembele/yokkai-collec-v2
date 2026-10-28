# À planifier

- DEAD-02 : supprimer discard_regular_pack_card à partir du 17/10, après vérification qu'aucun appel n'apparaît dans les logs Envoy depuis le 10/10.

- Réalisé : job CI `postgres17-auction-concurrency`, image de prod `supabase/postgres:17.6.1.136` (PostgreSQL 17.6), rejeu complet sous `postgres NOSUPERUSER` et 50 surenchères croisées avec deux sessions réelles. Bootstrap auth/storage/cron minimal partagé ; les jobs cron sont déclarés sans être exécutés dans ce cluster jetable. Le contrôle PGlite PostgreSQL 18.3 reste complémentaire.
- Un changement de domaine Supabase impose une migration de mise à jour de la liste des origines autorisées pour les avatars : le domaine est défini en dur dans `public.update_profile`, depuis `20261009000007_validate_profile_avatar.sql`. Coordonner cette migration avec le changement de domaine pour préserver l'envoi des avatars ; ne pas modifier la migration historique.
