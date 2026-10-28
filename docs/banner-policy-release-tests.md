# Contrat de tests préalable à la livraison du profil

PR de tests seule, extraite de #269 pour livrer le profil complet en une seule PR produit ensuite. L’utilisateur a confirmé la validation de Walid le 16 octobre 2026 pour remplacer le contrat autorisant des bannières importées ou des personnages non possédés.

- Toutes les assertions du test SQL historique restent exécutées, sur le schéma jusqu’à `20261016000000_profile_banner_frame.sql` inclus. La livraison produit ajoutera les tests de possession et de cadrage sur le replay courant.
- Le test UI conserve ses assertions historiques tant que le sélecteur possédé n’existe pas ; il exige ensuite le choix depuis la collection et l’absence d’import de bannière.
- Les tests des avatars et des limites Storage ne sont pas affaiblis.
- Aucun code produit, aucune migration et aucun changement de données.

Les tests du cadrage, absents de master, seront ajoutés directement avec la livraison produit et son schéma historique explicite. Aucun contournement du code par une fixture.
