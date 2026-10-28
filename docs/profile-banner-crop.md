# Cadrage des bannières du profil

Un écran « Crop banner » s'ouvre lors du choix d'un personnage ou d'un fichier
local. Le joueur déplace l'image à la souris, au tactile ou avec les flèches,
ajuste le zoom, choisit « Fit entire image » ou réinitialise le cadrage.
« Rotate 90° » tourne l'image par quarts de tour (0/90/180/270°), sans modifier
le fichier original. Le mode image entière reste actif après une rotation.
« Apply crop » valide le brouillon ; seul l'enregistrement du profil le persiste.
Annuler ne remplace pas la bannière précédente et n'envoie aucun fichier.

Le ratio 2,3:1 est commun à l'éditeur et au profil responsive. Le cadrage est
relatif, sans déformation. Aucun export canvas : l'image originale reste intacte,
notamment pour les GIF animés. Les limites de 4 Mo et les formats existants sont
conservés. Les fichiers importés sont envoyés uniquement à l'enregistrement.

## Base de données

`20261016000000_profile_banner_frame.sql` ajoute le cadrage et sa source au profil.
La nouvelle RPC réutilise les contrôles d'apparence existants et enregistre
l'apparence et le cadrage dans une transaction. Métadonnées bornées : x/y 0–100,
zoom 0,01–4 et rotation optionnelle limitée à 0/90/180/270°. Aucun accès direct joueur aux nouvelles colonnes ; aucun nouveau
droit d'upload, d'inventaire ou de lecture des collections.

Le cadrage ne s'applique qu'à l'image qui lui correspond. Les utilisateurs
bloqués ne reçoivent pas les nouvelles métadonnées. L'export personnel inclut
le cadrage, et la suppression du profil supprime également ces colonnes.
Les RPC historiques restent compatibles. Un serveur sans la migration renvoie
une erreur explicite lors de l'enregistrement d'un nouveau cadrage. L'éditeur
vérifie sa disponibilité avant tout envoi de fichier.

Migration **non appliquée en production**. Avant application : coordination avec
Walid et procédure officielle de sauvegarde/rejeu. L'ajout des tests de droits
SQL a été validé par l'utilisateur avec Walid. Aucune assertion existante retirée
ou assouplie : seul le chargeur du test de profil charge les nouveaux composants
réels. L'allowlist est étendue à la seule RPC authentifiée et owner-scoped.

## Aperçu et validation

- `/design-system/profile-preview?catalogue=demo` : ouvrir l'éditeur du profil,
  puis « Adjust banner » ou sélectionner un fichier/personnage.
- Tests ciblés : `tests/banner-frame.test.mjs`, `tests/banner-frame-api.test.mjs`,
  `tests/profile-banner-frame-db.test.mjs`.
- `node scripts/browser-proof-banner-crop.mjs` avec le serveur local sur 3000 :
  gestes souris/tactiles, zoom, ajustement entier, annulation, réouverture,
  imports, validation des fichiers et cohérence mobile/4K. Données simulées,
  aucune mutation de jeu. Captures dans `artifacts/banner-crop/`.
- CI complète exclusivement sur GitHub Actions.

Cette version remplace la proposition de cadrage fixe en portrait de la PR #266.
