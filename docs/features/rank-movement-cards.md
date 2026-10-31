# Évolution du rang dans la case personnelle — local

Les cartes personnelles de PowerRanking, J’aime et Licences contiennent désormais leur indicateur de rang. La ligne autonome sous la carte est retirée. Une hausse affiche une flèche verticale verte et le nombre exact de places gagnées ; une baisse utilise une flèche verticale rouge et les places perdues. Un rang inchangé reste neutre ; aucun mouvement n’est inventé sans relevé antérieur.

Le clic ou Entrée sur l’indicateur ouvre son historique réel, avec sa date de référence. Échap ferme cet historique et rend le focus au contrôle. Le panneau se place à gauche ou à droite de son ancrage selon l’espace disponible. Dans la liste, l’indicateur d’évolution est affiché uniquement sur la ligne du compte connecté, avec les mêmes directions et couleurs. Aucun indicateur n’est affiché pour les autres joueurs.

Les objectifs existants sont regroupés dans la colonne droite, au-dessus des règles, sur PowerRanking comme sur J’aime et Licences. Sur mobile, cette colonne suit la liste. Les recherches et la présentation précédente sont conservées.

Nouveaux tests EN/FR sur hausse, baisse, stabilité, premier relevé, historique accessible et version compacte. Aucun test existant modifié pour cette interface. Recette navigateur aux largeurs 320/375/768/1024/1440/720 et zoom CSS 200 % ; zoom natif 200 % non vérifié. Les exemples de hausse/baisse sont simulés seulement dans le navigateur de test, sans réécrire les observations réelles.

## Complément local : tous les classements

PowerRanking, J’aime, Licences et Parrainages affichent l’indicateur uniquement pour le compte connecté : sa carte personnelle et sa ligne dans le classement. Sans référence antérieure, le premier relevé reste neutre ; un compte non classé ou privé conserve un état explicite. Les profils des autres joueurs n’affichent aucun indicateur.

La migration `20261031030000_referral_rank_history.sql` est appliquée uniquement en local, pas sur le VPS. Elle conserve la fonction protégée existante de parrainage et ajoute son historique via le lecteur interne déjà utilisé par les autres classements. Retour arrière : `docs/rollback/referral-rank-history.sql`. Aucun droit API ni calcul de parrainage ne change.

Le choix d’une licence filtre maintenant la liste principale, la carte personnelle, les objectifs et les règles. Le bouton « Toutes les licences » restaure le score global. Le panneau séparé des co-leaders a été retiré ; les ex æquo gardent le même rang dans la liste principale. Recherche de joueur, filtre Amis et pagination restent disponibles pour la licence choisie.
