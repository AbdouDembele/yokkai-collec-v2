# Yokkai Collec' — Vision complète (roadmap long terme)

Ce fichier remplace les anciennes notes de brainstorm : il capture la version enrichie du concept.
Sert de référence globale — la v0.1 (voir `v0.1-mvp.md`) n'en couvre qu'une toute petite partie.

## Général

- Nom : **Yokkai Collec'**
- Jeu de collection de cartes gacha avec ouverture de boosters, marché aux enchères, échanges

## Catégories

Anime/Manga, Sport, Kpop, Cinéma, Série/Kdrama, Musique, Comics/Super-héros,
Streamer/Youtubeur, Influenceur, Politicien, Écrivain, Philosophe

## Raretés

`C → R → SR → SSR → LR`, avec variantes Shiny

- SSR → Shiny SSR : possible en consommant 3 exemplaires SSR non-Shiny identiques
- LR : uniquement en tirage direct, avec un jet Shiny propre aux LR
- Animation spéciale et différente à l'ouverture pour Shiny LR, LR et SSR

## Boosters

- **Regular Pack** : 10 cartes, régénéré toutes les 30 min
- **Decision Pack** : 10 cartes proposées toutes les heures, le joueur n'en garde qu'**une seule**
- Animation d'ouverture : un déclenchement global sur le paquet lance la séquence ; les cartes affichées dos face sont ensuite révélées successivement dans l'ordre, sans clic individuel
  de rareté croissante (les plus rares apparaissent en dernier)

## Compte & Profil

- Création de compte, choix du pseudo
- Édition du profil : photo, bio, 4 cartes mises en avant (choisies dans sa collection)
- Ajout d'amis par pseudo ; liste et nombre d'amis visibles uniquement par leur propriétaire, jamais par les visiteurs de son profil (même amis acceptés)
- Consultation du profil et de la collection des autres joueurs

## Collection

- Triée par rareté (plus rares en premier), filtrable
- Date d'obtention affichée sous chaque carte (visible par le possesseur et les visiteurs)
- Clic sur une carte → fenêtre détail :
  - Infos de la carte + valeur de marché (moyenne des enchères passées, rien affiché si aucun historique)
  - Bouton "Mettre aux enchères" (prix de départ par défaut 10 karas, durée au choix : 15min / 30min / 1h / 4h / 12h / 24h)
  - Bouton "Détruire rapidement" → conversion en karas : C=1, R=5, SR=15, SSR=30, LR=50
- Sélection multiple pour destruction groupée
- Max 5 cartes en enchère simultanée
- Customisation de l'image d'une carte de sa collection via Imgur

## Marché & Enchères (monnaie : Karas)

- Mettre une carte aux enchères la "freeze" (aucune autre action possible dessus)
  - Vendue → change de propriétaire ; non vendue → "defreeze", reste chez le possesseur
- Surenchère : bouton +10 karas, ou offre libre (minimum +10)
- Karas prélevés immédiatement à chaque enchère/surenchère
- Anti-snipe : une surenchère à moins de 5 min de la fin ajoute 1 minute
- Historique des mises visible sous l'image, sur la page d'enchère
- Filtres : rareté, prix (croissant/décroissant), fin imminente
- Vues dédiées : mes enchères en cours / enchères gagnées / cartes vendues

## Échange

- Carte contre carte(s), ou carte contre karas
- Réservé aux amis uniquement

## Succès / Missions

- Complétion de missions → récompense en karas
- Solde de karas affiché en haut à droite du site

## Recherche & Wishlist

- Recherche de carte → valeur, liste des possesseurs, ajout à la wishlist
- Wishlist visible par tous les visiteurs du profil
- Notification automatique quand une carte de la wishlist part aux enchères → clic renvoie
  directement sur la page de l'enchère
