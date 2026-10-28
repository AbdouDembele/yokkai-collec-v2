# Retour des bannières importées : transition de tests

Abdou demande de rétablir les imports depuis ordinateur/téléphone, avec cadrage,
en complément des cartes possédées. Validation de Walid confirmée par Abdou le
16 octobre 2026, ainsi que la coordination des migrations.

Cette PR de tests est séparée du code produit et de la nouvelle migration.

- Le contrat SQL owned-only reste intégralement testé sur son historique de
  migrations, sans retirer ses assertions. Le nouveau contrat fera un rejeu
  complet et vérifiera les imports, les sources étrangères, les limites et les droits.
- L’interface vérifie le mode historique tant que le bouton d’import est absent.
  À son retour, elle exige les deux sélecteurs de fichier, le nettoyage des URL
  temporaires et le contrôle du cadrage avant tout upload.
- Le sélecteur de cartes reste limité à la collection possédée.

Aucune migration dans cette PR. Aucun droit SQL ou code produit modifié.
