# Dragon Ball Z regroupé dans Dragon Ball

Demande du propriétaire du 25 octobre 2026 : rattacher **toutes les cartes Dragon Ball Z** au classeur **Dragon Ball** existant. Cette demande étend le regroupement initial de six films à la totalité du classeur Dragon Ball Z.

L'audit en lecture seule compte 183 cartes dans Dragon Ball et 59 dans Dragon Ball Z, soit **242 UUID distincts** réunis. Les 24 cartes des six films initialement cités font partie de ces 59 cartes. Dragon Ball Super (146), GT (15), DAIMA (34) et les autres classeurs restent inchangés.

La recette `supabase/recipes/merge_dragon_ball_z_20261025.sql` utilise la couche éditoriale existante : elle ajoute Dragon Ball comme destination et redirige uniquement l'ancienne clé stable de Dragon Ball Z vers cette destination. Les cartes, UUID, sources, images, raretés, liens secondaires, preuves de provenance, règles AniList, exemplaires possédés, wishlists et préférences enregistrées ne sont pas réécrits. Les nouvelles cartes routées dans Dragon Ball Z rejoindront également Dragon Ball.

Les anciens favoris, liens et widgets de Dragon Ball Z et de ses films rejoignent Dragon Ball via les résolveurs existants. Les préférences enregistrées restent intactes et les doublons de classeurs sont dédupliqués à la lecture. Les choix explicites du propriétaire restent prioritaires selon le comportement existant.

Aucune migration de schéma. La recette est préparée pour une application transactionnelle après CI verte, vérification de la base active, sauvegarde et répétition terminée par `ROLLBACK`. Les versions du mapping et les destinations sont contrôlées avant écriture ; toute divergence incompatible provoque un refus. L'état d'application effectif est consigné dans la PR.
