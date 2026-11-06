# Notification après acceptation d’une demande d’ami

Une acceptation réussie notifie l’expéditeur : « {pseudo} a accepté ta demande
d’ami ». Le lien ouvre le profil de la personne qui a accepté. La cloche et
les notifications push utilisent le même rendu traduit EN/FR.

L’écriture est transactionnelle dans le parcours existant d’acceptation. Les
refus, annulations, requêtes invalides et retries ne génèrent aucune nouvelle
notification. Une nouvelle acceptation après retrait puis nouvelle demande
réactive la notification de cette paire, sans multiplier les lignes. Le retrait
de l’amitié ne change pas l’identité de l’auteur ; le blocage applique les mêmes
protections que pour les autres interactions sociales.

Migration : `20261104050000_friend_request_accepted_notification.sql`, **non
appliquée en production**. Elle étend la contrainte des types de notifications
et les fonctions existantes, sans nouvel accès SQL, table ni privilège.
Aucune notification rétroactive n’est créée pour les amitiés existantes.

Aperçu local : `/design-system/friend-accepted-notification-preview` (FR),
`?lang=en` (EN). La lecture de cette fixture ne fait aucune écriture en base ;
le clic simule seulement le marquage comme lu. Les routes design-system restent
indisponibles en production.
