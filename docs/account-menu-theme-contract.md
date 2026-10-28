# Contrat de couleur du menu compte

PR de tests uniquement, préparée séparément du changement d'interface de la PR #417 conformément au workflow d'équipe. L'utilisateur a confirmé la validation de Walid le 21 octobre 2026.

Le contrat existant exige encore le fond violet `#0f0c1d` et une ombre teintée violette. Il conserve strictement ces attentes tant que le contrat dédié `tests/account-menu-navy.test.mjs` n'est pas installé par la PR d'interface. Une fois ce contrat présent, les assertions exigent exactement le fond `var(--color-night)` associé à `#060913`, la bordure `#344964` et l'ombre RVB `(6, 9, 19)`. Le violet est alors explicitement rejeté sur le menu.

Les deux palettes ne sont pas acceptées indifféremment ; la sélection ne dépend ni d'une variable d'environnement ni de l'état de la CI. Toutes les assertions de structure, d'actions, d'accessibilité, de taille et de comportement mobile sont conservées. La PR d'interface ajoute ses contrôles de survols, de couleurs de texte et de déconnexion.

Aucun changement de code produit, de droits SQL, de migration ou d'assets dans cette PR.
