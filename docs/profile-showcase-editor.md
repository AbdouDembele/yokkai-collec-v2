# Éditeurs séparés : profil et vitrine

Le bouton propriétaire « Edit showcase » remplace « Sa vitrine » dans l'en-tête
du bloc « Cartes mises en avant ». Il utilise le même bouton secondaire que
« Modifier le profil » ; les visiteurs ne voient aucun bouton d'édition.

L'éditeur du profil ne rend que la photo, la bio et les réglages de bannière.
L'éditeur de vitrine ne rend que le sélecteur de cartes existant : recherche,
sélection remontée et cinq cartes différentes au maximum. Les brouillons sont
réinitialisés à chaque changement d'éditeur. Fermer/annuler n'enregistre rien.

Les deux modes réutilisent le mécanisme d'enregistrement d'apparence déjà en
place. Les champs non édités sont conservés. Aucun nouveau droit, RPC ou
migration pour cette séparation d'interface.

Cette branche reprend également le cadrage et la rotation de #267, non mergés
au moment du travail. La migration de cadrage `20261016000000_profile_banner_frame.sql`
reste **non appliquée en production**. Aucune modification de production ici.

## Validation

- `node --test tests/profile-editor-sections.test.mjs`
- `node scripts/browser-proof-profile-editors.mjs`, avec le serveur sur 3000 :
  données de démonstration uniquement ; placement/style du bouton, deux modes
  exclusifs, annulation, conservation de la bio/bannière/vitrine, recherche,
  mobile et absence du bouton pour les visiteurs.
- Régression du cadrage : `node scripts/browser-proof-banner-crop.mjs`.
- Aucune assertion existante retirée ou assouplie. CI complète sur GitHub.
