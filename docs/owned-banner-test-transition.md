# Transition des tests : bannières de cartes possédées

Décision utilisateur : les nouvelles bannières doivent être choisies dans les cartes possédées, sans import d’image ni recherche globale du catalogue. Validation de Walid confirmée par l’utilisateur le 16 octobre 2026 pour adapter le contrat dans une PR de tests séparée.

Cette PR ne modifie aucun code produit et ne contient aucune migration.

- Les tests SQL historiques d’import et de cadrage conservent toutes leurs assertions. Ils rejouent le schéma jusqu’à `20261016000000_profile_banner_frame.sql`, dernière version autorisant ces choix.
- Les contrôles statiques du formulaire suivent explicitement le nouveau sélecteur lorsqu’il existe : collection uniquement, aucun upload de bannière et contrôle du cadrage avant l’enregistrement. Sinon, leurs assertions historiques restent exécutées.
- Les tests des photos de profil et de la limite de 4 Mo restent inchangés. L’ancien helper d’upload de bannière reste testé comme compatibilité Storage ; sa présence ne permettra pas d’enregistrer une URL de bannière dans la nouvelle politique serveur.
- La PR produit suivante doit ajouter des tests sur le replay complet : possession, rejet d’URL, RPC anciens/nouveau, révocation après perte de la dernière copie et atomicité. Les preuves navigateur historiques restent intactes ; une nouvelle preuve couvre les choix possédés.

PR empilée sur la séparation profil/vitrine (#268), afin de ne pas mêler les changements de contrat de tests et le code qu’ils vérifient. Aucun merge ni déploiement implicite.
