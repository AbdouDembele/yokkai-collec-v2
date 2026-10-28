# Suppression de compte côté serveur

Les paramètres proposent la confirmation en retapant son pseudo. L’action serveur
vérifie la signature du JWT avec Supabase, l’identité encore active et une
authentification de moins de cinq minutes (`auth_time`, ou AMR signé password,
magiclink/otp ou OAuth si auth_time manque). `iat` seul ne suffit jamais ; une
preuve absente, invalide ou ancienne exige une reconnexion. L’UUID provient
uniquement de la session vérifiée, sans accepter un UUID du navigateur.

La clé `SUPABASE_SECRET_KEY` (ou `SUPABASE_SERVICE_ROLE_KEY`) reste exclusivement
dans l'environnement serveur. Ne jamais la préfixer `NEXT_PUBLIC_`, la journaliser
ou la transmettre au navigateur.

Le service procède dans cet ordre :

1. Enregistrer et valider le journal UUID/date dans une transaction distincte.
   Cette clôture attend les écritures en cours et interdit les nouvelles écritures
   du joueur et les références à ce joueur, y compris avec un ancien JWT valide.
2. Annuler ses ventes actives et rembourser les meilleurs enchérisseurs ; retirer
   ses mises gagnantes sur les ventes des autres, qui continuent au prix initial.
   Une vente finissant dans moins de trois minutes reçoit au moins cinq minutes.
3. Annuler les échanges en attente, effacer les données personnelles et détacher
   les identités des historiques. Les cartes conservées dans l'historique sont
   des instantanés du catalogue, sans images personnalisées.
4. Effacer les avatars via l'API Storage, puis l'identité, les sessions et les
   identités OAuth via `auth.admin.deleteUser(uuid, false)`.

Les deux RPC SQL sont exécutables uniquement par `service_role`. Elles ne
suppriment directement aucune ligne d'Auth ou de Storage. Le journal survit à
l'effacement et reste accessible au seul service ; son UUID reste une donnée
personnelle nécessaire à la réapplication des effacements après restauration.

Un échec conserve le journal et bloque les anciennes sessions. Une reprise par
le service avec le même UUID est idempotente : aucun double remboursement,
les avatars peuvent être retirés à nouveau et une identité déjà absente est
acceptée. Les autres erreurs Auth restent bloquantes. Aucun retry automatique.
Un objet appartenant au joueur dans un bucket autre que `avatars` exige une
revue administrative avant l'effacement : les ressources globales ne sont
jamais supprimées automatiquement.

Déploiement : les migrations de fondation et de suppression serveur doivent être
appliquées via `scripts/deploy-migrations.sh` avant d’activer cette interface.
Configurer la clé privée dans l’environnement serveur de l’application (jamais
dans une variable `NEXT_PUBLIC_`). Le bouton ne peut pas supprimer de compte sans
cette configuration ; aucun secret ne doit être envoyé dans une conversation.
Après succès, l’action déconnecte, efface les cookies Auth et redirige vers la
page publique `/account-deleted`.
