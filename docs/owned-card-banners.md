# Bannières réservées aux cartes possédées

- Le formulaire propose les cartes de la collection actuelle, dédupliquées par carte du catalogue, avec recherche locale par nom/licence/catégorie. Les résultats sont bornés à 36 avec indication et recherche pour les grandes collections.
- La bannière utilise l’image catalogue, jamais une image personnalisée de copie. Le cadrage, le zoom et la rotation restent disponibles.
- Plus d’import de bannière ni de recherche globale. L’import de la photo de profil reste disponible (4 Mo).
- Les RPC `update_profile`, `update_profile_appearance` et `update_profile_appearance_framed` appliquent la même possession côté serveur. Toute URL non vide de bannière est refusée, même pour un ancien client.
- La perte de la dernière copie retire sa bannière ; supprimer un doublon ne la retire pas. Le contrôle différé observe l’état final de la transaction : une évolution consommant des copies puis créant leur remplacement conserve la bannière. Le trigger n’est pas appelable par les joueurs et n’accorde aucun droit d’inventaire.
- Pas de modification massive des anciennes bannières et aucun fichier Storage supprimé. Elles sont remplacées lors du prochain enregistrement d’apparence ; le formulaire l’annonce. Les migrations restent non appliquées en production.

## Livraison

PR produit empilée après #268 (cadrage/vitrine), puis la PR de contrat de tests #269 validée avec Walid. La PR produit n’affaiblit aucun test existant.

Migration `20261016000001_owned_card_banners.sql` : NON appliquée sur le VPS. Elle dépend de `20261016000000_profile_banner_frame.sql`, également NON appliquée. Coordination de migration à reconfirmer avant la production. Aucun merge ni déploiement dans cette tâche.

## Validation ciblée

- `tests/owned-card-banners-db.test.mjs` : droits, possession, anciens clients, crop, atomicité, perte de dernière copie et export sur replay courant jetable.
- `tests/owned-card-banners.test.mjs` : sélecteur local, absence d’upload, erreurs et paramètres d’enregistrement.
- `scripts/browser-proof-owned-card-banners.mjs` : démonstration locale, recherche, choix, cadrage/rotation, annulation, enregistrement, mobile et conservation de la vitrine.

Les anciennes preuves navigateur d’import restent des traces historiques et ne décrivent plus le contrat courant.
