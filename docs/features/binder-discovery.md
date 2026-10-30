# Découverte des classeurs — travail en attente

Cette évolution reste en PR brouillon jusqu'au nettoyage des licences en production demandé par Abdou. Ne pas fusionner, déployer ni appliquer la migration sur le VPS avant sa reprise explicite.

## Comportement

- Collection : onglets « My cards / My binders » et « Mes cartes / Mes classeurs », alignés à droite au-dessus des cartes ; couvertures illustrées et ouverture directe par identité stable du classeur. Le retour conserve la recherche, la pagination et le filtre des favoris.
- Accueil : trois classeurs favoris ou en cours, progression et accès direct, juste après « Gros tirages » et avant le fil public. Les lectures sont bornées à une page de 72 statistiques et trois couvertures.
- Après un pack : progression des classeurs correspondant aux nouvelles cartes distinctes réellement conservées. Les doublons, cartes vendues et cartes non choisies d'un Decision Pack ne sont pas comptés. Aucune règle de drop ou de transfert ne change.
- Liste de ses classeurs : favoris personnels, puis nombre de joueurs distincts ayant placé la licence en favori, calculé avant la pagination. Les égalités sont départagées par progression puis identité. Les anciens favoris, choix explicites et fusions sont réconciliés pour compter une seule fois chaque joueur. La consultation des classeurs d'un autre joueur conserve son ordre personnel.
- Textes source EN et traduction FR intégrés aux catalogues.

## Migration

`20261029210000_binder_popularity.sql` : nouvel agrégat anonyme `binder_popularity_counts(text)`, modification des deux lecteurs de ses propres albums pour le tri avant pagination. Droits existants des lecteurs et contrôles de confidentialité conservés. L'agrégat exige une session et ne renvoie aucune identité de joueur.

Appliquée uniquement à la base locale Kara ; **pas appliquée au VPS**. Après le nettoyage des licences, revoir les regroupements et la version de migration, vérifier le schéma réel et coordonner l'application SQL avant toute fusion/déploiement.

L'ajout de cette nouvelle fonction à la liste des SECURITY DEFINER accessibles à authenticated a été explicitement validé par Walid. Aucune entrée existante ni assertion de sécurité n'est supprimée ou assouplie. Le test de retour aux classeurs ajoute seulement les mocks CSS et navigateur nécessaires ; ses assertions restent inchangées.

## Reprendre les essais locaux

- Site : http://localhost:3000/collection?view=binders
- Démo isolée : http://localhost:3000/design-system/binders-preview?mode=home ; modes collection, packs et discovery disponibles. Le mode discovery représente un joueur sans favoris.
- La route de démonstration renvoie 404 en production. Le script `scripts/prove-binder-discovery.mjs` vérifie les parcours EN/FR avec Chrome, sans mutation de compte ; définir PREVIEW_URL pour changer le serveur.
- Les statistiques réelles de la base locale ne contiennent actuellement aucun favori ; la démonstration utilise ses propres données fictives sans créer de votes sur les comptes.
- Les captures et journaux restent dans .tools/binders-proof et .tools/binders-popularity, hors dépôt. Le retour arrière de la migration locale est conservé dans ce dernier dossier.
- Le réglage des ports dans supabase/config.toml est propre à ce poste et reste exclu de cette PR, comme les fichiers .env et les données locales.
- Le rendu a été vérifié de 320 à 1440 px et en mise en page équivalente à 200 %. Le zoom natif du navigateur à 200 % reste non vérifié.

Les contrôles complets sont exécutés par GitHub Actions. Consulter les checks de la PR avant de reprendre la livraison.

## Adaptation du contrat de navigation validée par Walid

Le test collection-panini-performance remplace les deux contrôles de l’ancien bouton bascule Classeur par deux contrôles précis : l’onglet Cartes active la grille et efface le classeur sélectionné ; l’onglet Classeurs affiche son état actif et ouvre les classeurs. Les deux autres assertions du test restent inchangées. Walid a explicitement validé cette adaptation au nouveau comportement produit. Les tests des ouvertures de packs restent inchangés ; la progression des classeurs est chargée à la demande.

## Couvertures issues du catalogue

Les pages de classeurs renvoient une image représentative de leur propre catalogue, même sans exemplaire possédé. La sélection reprend les associations exactes et le filtre de catégorie, ignore les URL vides et privilégie les raretés élevées, avec un départage stable par identifiant. Elle est limitée aux classeurs de la page et réutilise le catalogue déjà lu ; aucun appel par couverture ni téléchargement complet du catalogue dans le navigateur. Les images personnalisées des joueurs ne sont pas utilisées.

La Collection et l'accueil utilisent cette couverture, avec le repli préexistant si un ancien serveur ne renvoie pas le champ. Aucun ordre, compteur de progression, favori, droit ou contrôle de confidentialité n'est modifié.

Migration supplémentaire : 20261030200000_binder_cover_images.sql, appliquée uniquement à Kara pour cette reprise locale, pas au VPS. Elle remplace les deux lecteurs existants sans changer leur signature ni leurs privilèges. Les tests ajoutés vérifient les cartes non possédées, catégories homonymes, licences secondaires, URL vides, pagination et accès privés. Les tests existants restent inchangés.

## Présentation des titres et compteurs

Le titre occupe l'en-tête de chaque classeur, centré s'il est court et aligné à gauche au-delà de 32 caractères, sans troncature. L'étoile reste en haut à droite. La couverture garde sa taille validée : 120 px de largeur, 108 px sur les cartes étroites. Le compteur est à droite de la couverture, avec le total et le libellé traduits ; le pourcentage et sa barre sont regroupés en dessous. La page conserve ses alignements par rangée et les commandes restent accessibles au clavier.
