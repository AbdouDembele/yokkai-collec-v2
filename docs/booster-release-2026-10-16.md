# Livraison sélective des boosters

Demandée par Abdou :

- Habillage commun sombre bleu nuit/lavande et bordure claire sur les deux panneaux. Le fond blanc nacré rejeté n'est pas livré.
- Déchirure CSS du haut du paquet avec halo et scintillements dorés pour les deux types de packs.
- Textes SSR/LR rapprochés de la carte, avec une ligne Shiny distincte et une adaptation aux écrans courts.

## Exclusions

- Aucune modification de `public/assets/booster-pack.png`, `decision-booster-pack.png` ou `card-back.png` : conserver les images actuellement en production.
- Aucun changement des révélations SR/SSR/LR/Shiny, des durées, des taux, des RPC ou des récompenses, hormis le placement des textes et la taille responsive des grandes cartes sur écran court.
- Aucune migration Supabase. Aucun test existant modifié ou affaibli.

Les essais d'images et le brouillon #278 restent séparés. La livraison part directement de `origin/master`, pas de la branche expérimentale.
