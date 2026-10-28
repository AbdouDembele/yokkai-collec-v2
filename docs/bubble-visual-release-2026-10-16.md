# Livraison des visuels Yokkai nacrés

## Inclus

- Logo Yokkai blanc nacré sur la navigation, l’accueil et l’authentification, avec son ratio natif.
- Pochettes régulière et décisive violettes/nacrées. Le logo du régulier reprend celui du décisif, légèrement réduit ; les marges transparentes sont conservées.
- Mêmes pochettes dans les deux calques de la déchirure CSS déjà en production.
- Dos des cartes violet nacré simplifié, sans logo ni gemmes.
- Tests additionnels de dimensions, intégration des images et transparence des marges du régulier.

## Exclus

- Packs illimités et SSR/LR garantis : réservés à l’aperçu local.
- Chargement du catalogue réel dans la démo locale.
- Aucun changement des RPC, taux, récompenses, réserves, délais, effets de révélation ou règles Shiny.
- Aucun changement de thème général ni des anciennes images conservées pour retour arrière.
- Aucune migration Supabase, rien à appliquer sur le VPS.

## Séparation des tests et livraison

La PR de tests #293 prépare séparément les cinq contrats historiques qui imposaient les anciens noms de fichiers. Validation avec Walid confirmée par l’utilisateur avant cette adaptation. Cette livraison produit ne modifie aucun test existant.

Après CI GitHub verte sur une branche à jour avec master, fusionner et laisser le webhook Coolify déployer. Vérifier le commit actif, les réponses HTTP et les empreintes des quatre images. Ne pas déclencher un second déploiement manuel.
