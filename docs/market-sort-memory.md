# Conserver le tri du Market

Le tri « Sort by » est mémorisé dans `sessionStorage`, dans l’onglet courant.
Ouvrir une enchère puis revenir avec le bouton de retour ou l’historique du
navigateur restaure le tri. Un rechargement du même onglet le conserve aussi.
Les choix autorisés sont `end`, `asc`, `desc` et `popular` ; toute valeur invalide
est ignorée. « Reset filters » choisit et mémorise explicitement `end`.

Le store ne sauvegarde que ce choix de présentation, aucune donnée de compte.
Il est partagé par les montages successifs de la liste. `useSyncExternalStore`
conserve un rendu serveur déterministe avant de restaurer le choix du navigateur,
sans écraser la préférence pendant l’hydratation. Si le stockage est bloqué,
la navigation conserve le choix en mémoire sans faire planter le Market.

Les autres filtres, les tris SQL et les droits restent inchangés. Le changement
réutilise le rappel de filtres existant pour charger le préfixe SQL correspondant
au tri restauré. Aucune migration et aucun nouveau texte joueur.

La recette navigateur utilise le vrai `MarketView` avec des cartes fictives et
vérifie le tri sélectionné ainsi que celui envoyé au rappel de chargement :
retour historique, lien de retour, rechargement et remise à zéro. Elle couvre
320, 375, 768, 1024 et 1440 px à 100 % et 200 %, sans erreur d’hydratation.
