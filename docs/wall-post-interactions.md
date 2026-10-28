# Likes et réponses aux posts du mur

Sur Home et sur le mur du profil : bouton Like/Unlike avec compteur, réponses
texte de 1 à 1 000 caractères, pagination de 10 réponses, suppression de sa
propre réponse. Identité fournie exclusivement par `auth.uid()`. Un visiteur
public non ami ne peut pas interagir ; l'auteur peut consulter ses propres posts.

Les deux tables sont sous RLS sans droit direct pour les joueurs. Quatre RPC
authentifiés vérifient le post, l'amitié acceptée, `can_read_profile_wall`, les
blocages bilatéraux, les comptes bannis et les barrières de suppression. Les
compteurs et les réponses masquent les auteurs que le lecteur ne peut pas voir.
Les réponses utilisent un UUID idempotent ; les likes écrivent un état voulu
(pas une bascule aveugle). Sérialisation par auteur : 5 secondes entre réponses,
30 par heure, 500 réponses au maximum par post. Aucun HTML n'est interprété.

La suppression du post cascade ses interactions. La barrière de suppression
d'un compte nettoie immédiatement ses likes et réponses. L'export de données
ajoute seulement les contributions du compte exporté ; le constructeur précédent
devient owner-only. Le wrapper STABLE conserve le même snapshot, les contrôles de
réservation/suppression et les plafonds globaux de lignes et de taille.

## Migration et validation

- `20261021010000_wall_post_interactions.sql` : appliquée uniquement au Supabase
  local `supabase_db_Kara` (port 54322), **pas sur le VPS**.
- Les quatre nouveaux RPC et les helpers owner-only sont justifiés explicitement
  dans l'allowlist. Validation de Walid requise avant toute mise en production.
- Aperçu avec mocks : `/design-system/home-preview`. Le vrai Home local utilise
  les RPC ; aucune publication de test n'est ajoutée en production.
- Pas de notifications, de pièces jointes dans les réponses, ni de sous-réponses
  imbriquées dans cette première version.

## Réactions emoji et présentation

Sélecteur accessible de 24 emojis, recherche et catégories. Les réactions
apparaissent en pastilles avec compteurs ; celles du lecteur sont surlignées et
peuvent être retirées en cliquant à nouveau. Au maximum 8 emojis différents par
post et par compte. Les clés autorisées sont partagées avec la contrainte SQL
et contrôlées par un test de synchronisation du catalogue.

`20261021020000_wall_emoji_reactions.sql` est appliquée uniquement en local,
**pas sur le VPS**. Nouveau RPC authentifié `set_wall_post_reaction`, mêmes ACL
que les likes/réponses. Tables sans droit direct, helpers owner-only, export de
ses seules réactions, nettoyage à la suppression du post/compte. Les anciennes
lectures et mutations restent compatibles avec l'activité enrichie.

La barre d'actions, les bulles des réponses et le sélecteur reprennent le bleu
nuit du site. La fenêtre réutilise le dialog du site, avec clavier, fermeture
Échap et restauration du focus ; affichage adapté au mobile et au mouvement réduit.
