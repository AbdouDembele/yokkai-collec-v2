# Classements tournants sur l’accueil — local

Le bloc Classement alterne PowerRanking, J’aime des profils et Licences, toutes les cinq secondes. La navigation manuelle reste disponible via les trois onglets ; aucun bouton pause ni commande en bas. Le lien Voir le classement ouvre directement le classement affiché via /leaderboard?ranking=likes ou licenses ; sans paramètre ou avec une valeur inconnue, PowerRanking reste l’entrée par défaut.

Le PowerRanking existant reste rendu par le serveur, sans changement de calcul, de composant ou de texte interne. Les deux autres vues reprennent leurs lecteurs SQL existants avec une limite de six joueurs. Elles affichent les mêmes noms, avatars et styles autorisés, podium et rangs réels ; Licences montre les deux ratios globaux et le départage validé. Aucun classement de parrainage ne tourne dans ce bloc.

Chargement des deux lectures uniquement à l’arrivée du bloc dans la zone visible ; une lecture par vue et par montage, partagée entre les cycles. Pas de polling ni lecture à chaque transition. Une erreur se limite à sa vue et se relance manuellement. Les lecteurs existants conservent les protections de confidentialité et la page bornée. Aucune migration SQL supplémentaire, aucune écriture en base.

La rotation se suspend au survol, au focus clavier, quand l’onglet est masqué ou le bloc hors écran. Les préférences de mouvement réduit désactivent la lecture automatique initiale et les transitions ; la navigation manuelle reste disponible. Les vues inactives sont inertes et cachées aux technologies d’assistance. L’animation de translation respecte les préférences du navigateur ; la hauteur du bloc suit le contenu de la vue active, mesuré à chaque changement de vue, chargement et redimensionnement, afin de ne pas réserver un grand espace vide sous les vues plus courtes.

Source EN et traduction FR dans homeRankingCarousel ; aucun texte interne du PowerRanking n’est changé. Tests existants conservés, contrôles supplémentaires des lectures bornées et du carrousel.

Recette locale : cycle complet et hauteur adaptée au contenu, commandes, pauses au survol/focus/hors écran, liens directs et retour à PowerRanking ; EN/FR, largeurs 320, 375, 600, 768, 1024, 1440 et 720 px sans débordement. Le mouvement réduit, une panne isolée avec relance, et un jeu synthétique de six profils aimés avec styles ont été vérifiés dans le navigateur, sans création de likes en base. La largeur de 720 px ne remplace pas un contrôle du zoom natif : le zoom natif à 200 % reste non vérifié. Le test existant i18n-home-ranking reste inchangé et passe ; le nouveau test home-ranking-carousel-data vérifie les appels bornés, leur mode et les liens.

Retouche : suppression du bouton pause ; rotation automatique toutes les cinq secondes. Le bloc conserve sa hauteur adaptative.

Validation Walid obtenue pour remplacer uniquement la valeur attendue du test du carrousel : 5000 ms au lieu de 8000 ms. Toutes les autres assertions restent intactes. Cette adaptation doit figurer dans la description de la PR #15.
