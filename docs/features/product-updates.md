# Fenêtre de nouveautés — aperçu local

L’accueil connecté présente une annonce « Classeurs & classements » : découverte des classeurs, favoris et progression ; PowerRanking, J’aime des profils et progression des licences. Deux liens rejoignent les fonctionnalités et un bouton ferme la fenêtre. Anglais source et français inclus.

L’identifiant de publication est défini dans `lib/ui/product-updates.ts`. Une nouvelle publication nécessite un nouvel identifiant. Le premier affichage est mémorisé pour le compte connecté dans les métadonnées Auth, par une action serveur qui n’accepte ni identifiant de joueur ni version venant du navigateur. Elle utilise uniquement la session. Aucun droit, score ou réglage de profil ne change.

Une copie locale par compte et publication évite les répétitions avant la synchronisation serveur. Si le stockage est bloqué, la mémoire de l’onglet et l’accusé de lecture du compte restent utilisables. Si la sauvegarde réseau échoue, l’accueil suivant retente silencieusement ; un appareil sans cette sauvegarde peut réafficher l’annonce. Le premier affichage est différé tant qu’une autre fenêtre est ouverte ou que l’onglet est masqué. Elle apparaît sur l’accueil, jamais pendant l’ouverture de packs.

La route locale `/design-system/product-updates-preview` permet de revoir le même composant sans écrire de reçu ni modifier le compte. Elle renvoie 404 en production. Le dialogue commun conserve le focus, Échap et le défilement interne sur petit écran. Aucune migration SQL ; aucun déploiement dans cette itération.
