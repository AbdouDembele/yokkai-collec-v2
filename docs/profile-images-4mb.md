# Photos de profil et bannières : 4 Mo

La limite commune est de 4 × 1024 × 1024 octets (4 194 304), incluse.
Les deux fonctions d’upload et l’aperçu utilisent la même constante.
Les messages d’erreur et les indications du formulaire annoncent 4 MB.
JPG, PNG, WebP et GIF restent autorisés ; SVG reste refusé.

Migration : `20261015200000_profile_images_4mb.sql`.
Elle modifie uniquement `file_size_limit` du bucket `avatars`, partagé avec les
bannières. Aucun objet, utilisateur, droit d’accès ou format autorisé n’est changé.
À appliquer via `scripts/deploy-migrations.sh` avant le front, avec sa sauvegarde
validée et sa vérification de dérive. Coordination avec Walid confirmée.

État constaté avant changement : bucket limité à 2 097 152 octets en production.
La migration `20261015190000_english_achievement_texts` de Walid est déjà appliquée
sur le VPS mais sa PR #255 n’est pas encore mergée : le dossier de déploiement doit
inclure sa référence exacte déjà appliquée pour vérifier le registre complet,
sans l’ajouter à cette PR ni la réappliquer.

Retour arrière : ramener la limite du bucket et du front à 2 097 152 octets via
une migration corrective. Les images déjà envoyées ne doivent pas être supprimées.
