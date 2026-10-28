# Popularité et suivi des enchères

Le Market place les annonces suivies par le joueur connecté avant les autres,
puis applique le tri choisi dans chaque groupe. Cette priorité s'applique avant
la limite de pagination SQL et côté navigateur après un changement de suivi.
Les filtres de recherche, catégorie et rareté restent appliqués.

« Most popular » compte les joueurs distincts qui ont enchéri sur l'annonce ou
qui la suivent actuellement. Un même joueur compte une seule fois même s'il a
fait plusieurs mises et suit l'annonce. Le vendeur et les enchérisseurs dont le
compte a été supprimé sont exclus. Retirer un suivi enlève le point si le joueur
n'a jamais enchéri. Chaque annonce a son propre score, y compris pour deux
exemplaires de la même carte. À égalité, la fin la plus proche puis l'identifiant
départagent les annonces. Le prix, les favoris importés du catalogue, les vues,
les raretés et les variantes n'ajoutent aucun point.

Le score conserve la clé API `popularity`. Les RPC de liste complète, de liste
par curseur et de navigation filtrée emploient la même définition. Aucune
identité de joueur suivant une annonce n'est ajoutée aux réponses. Les index
existants sur les enchères des mises et des suivis permettent de borner les
sous-requêtes à chaque annonce. Aucun compteur persistant ni nouveau droit SQL.

Migration : `20261028150000_market_player_interest.sql`. Elle remplace trois
définitions de fonctions existantes, conserve leurs droits et ne modifie aucune
carte, mise, solde ni préférence de suivi. L'application en production demande
la coordination SQL prévue par `docs/COLLABORATION.md`, §6.

La nouvelle couverture teste les scores exacts, les répétitions et recoupements,
le retrait du suivi, les préférences propres à chaque joueur, les quatre tris,
les filtres, les préfixes de plus de 100 annonces et l'accès anonyme refusé.
Les tests historiques restent inchangés, y compris ceux de l'ancienne migration.

Le contrôle navigateur couvre 320, 375, 768, 1024 et 1440 px, à 100 % et 200 %.
À fort zoom, les métadonnées étroites passent sur plusieurs lignes et les
colonnes du Market peuvent se replier sans masquer les filtres ou les valeurs.
