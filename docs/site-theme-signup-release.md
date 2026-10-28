# Livraison bleu nuit et inscription — 20 octobre 2026

Livraison regroupée demandée par le propriétaire :

- Fonds et panneaux bleu nuit, comme la navigation, avec la dernière nuance plus
  foncée validée en local ; boutons Open et boutons d'enchère harmonisés.
- Karas blancs/nacrés à la place du jaune monétaire. Couleurs des raretés,
  personnalisation des pseudos, images et animations de révélation conservées.
- Conditions publiques `/terms`, éditeur **Yokkai Collec**, contact
  `yokkaicollec@gmail.com`, version `2026-10-20`, sans mentions de brouillon.
- Acceptation obligatoire des conditions/règles à l'inscription, décochée au
  départ et vérifiée dans la Server Action ; emojis interdits dans les nouveaux
  pseudos. Seul « 3–30 characters. » est conservé sous le champ.

## Séparation des tests

Validation de Walid confirmée par le propriétaire. #403 prépare la palette bleu
nuit ; #405 prépare l'acceptation, les pseudos et la dernière nuance plus foncée.
La livraison produit part de master après leur fusion et ne modifie aucun test
déjà présent sur cette base. Les tests spécifiques ajoutés dans cette livraison
imposent les couleurs exactes, les refus serveur, les liens accessibles et les
conditions publiées (éditeur, date et absence de prévisualisation).

Les PR #402 et #404 sont remplacées par cette livraison regroupée pour conserver
un seul lot final vérifié, sans intégrer d'autres essais du workspace.

## Déploiement

**Aucune migration Supabase. Aucun SQL appliqué au VPS pour ce lot.**

Fusion via PR uniquement après CI GitHub verte sur master à jour. Laisser le
webhook Coolify effectuer le déploiement ; ne pas déclencher un second build
manuel en parallèle. Contrôler le commit dans la file, le conteneur actif et les
pages HTTP publiques. Les limites du contrôle d'acceptation sont documentées dans
`docs/terms-of-use-review.md` ; aucun registre de preuve immuable n'est revendiqué.
