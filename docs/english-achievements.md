# Succès : textes anglais

Migration : `20261015190000_english_achievement_texts.sql`. **Appliquée au VPS auto-hébergé le 15/10/2026**, après autorisation de Walid et CI GitHub verte sur `5ba545ca`. Sauvegarde validée, MD5 local/VPS identique (`dd8191aea7e81265d46afb634d3d6674`), registre vérifié puis mis à jour dans la même transaction.

Les onze définitions existantes de `public.achievements` reçoivent uniquement un nouveau `titre` et une nouvelle `description`. IDs, conditions, catégories et récompenses restent identiques. Les tables joueurs, notifications et catalogue ne sont pas modifiées ; les notifications affichent le titre de la définition par jointure existante. Aucune fonction SQL ni route ne change. Les nouvelles fonctions ou les futurs succès UR relèvent des PR d'Abdou, hors périmètre ici.

La migration est idempotente : une définition déjà traduite ne déclenche aucune mise à jour supplémentaire. À l'application, les libellés des onze IDs remplacent les libellés existants : vérifier les éventuels changements concurrents avant déploiement.

## Libellés proposés

| ID technique conservé | Titre                  | Description                                  |
| --------------------- | ---------------------- | -------------------------------------------- |
| premier-rituel        | First Ritual           | Open your first Regular Pack.                |
| habitude-installe     | Getting into the Habit | Open 10 Regular Packs.                       |
| chasseur-yokkai       | Yokkai Hunter          | Open 50 Regular Packs.                       |
| decision-decisive     | Decisive Choice        | Complete your first Decision Pack.           |
| collection-en-marche  | Collection in Motion   | Collect 25 different cards from the catalog. |
| legende-naissante     | A Legend Begins        | Collect your first LR card.                  |
| eclat-inattendu       | Unexpected Sparkle     | Collect your first Shiny card.               |
| specialiste           | Specialist             | Collect 50% of any category.                 |
| adjuge                | Going, Going, Gone!    | Win your first auction.                      |
| marche-conclu         | Deal Done              | Complete your first accepted trade.          |
| transcendance         | Transcendence          | Obtain your first evolved Shiny SSR card.    |

## Vérification des règles actives

Lecture des définitions et fonctions réellement actives sur le VPS le 15/10/2026, sans modifier de donnée joueur. Les dix autres anciens textes correspondent aux règles ; seule Transcendance présente un écart de sens.

| IDs                                                  | Condition réelle et source lue                                                                                                                      | Description anglaise vérifiée                                                   |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| premier-rituel / habitude-installe / chasseur-yokkai | `regular_packs_opened >= 1 / 10 / 50`, compteur incrémenté par `open_regular_pack`                                                                  | Open your first Regular Pack. / Open 10 Regular Packs. / Open 50 Regular Packs. |
| decision-decisive                                    | `decision_packs_completed >= 1`, transition `pending → claimed` dans `on_decision_pack_completed_achievement`                                       | Complete your first Decision Pack.                                              |
| collection-en-marche                                 | `count(distinct card_id) >= 25` dans `achievement_progress`                                                                                         | Collect 25 different cards from the catalog.                                    |
| legende-naissante                                    | Existence d’une carte possédée dont `cards.rarete_base = LR`                                                                                        | Collect your first LR card.                                                     |
| eclat-inattendu                                      | Au moins une carte possédée avec `is_shiny = true`                                                                                                  | Collect your first Shiny card.                                                  |
| specialiste                                          | Maximum par catégorie de `floor(100 × cartes distinctes possédées / cartes distinctes du catalogue) >= 50`                                          | Collect 50% of any category.                                                    |
| adjuge                                               | `auctions_won >= 1`, transition `active → sold` avec acheteur non nul dans `on_auction_won_achievement`                                             | Win your first auction.                                                         |
| marche-conclu                                        | `trades_completed >= 1` pour les deux participants, transition `pending → accepted` dans `on_trade_completed_achievement`                           | Complete your first accepted trade.                                             |
| transcendance                                        | `ssr_evolved_to_lr >= 1`, compteur incrémenté lors de l’insertion ou de l’acquisition d’une carte `is_evolved` dans les deux déclencheurs de cartes | Obtain your first evolved Shiny SSR card.                                       |

Écart constaté : ancien texte actif « Évoluer une première carte SSR en LR. » → nouveau texte « Obtain your first evolved Shiny SSR card. ». La fonction `evolve_ssr_card(uuid[])` exige exactement cinq identifiants distincts appartenant au joueur, tous pour la même carte de base SSR, de rareté possédée SSR et non Shiny. Elle consomme ces cinq exemplaires et insère une carte SSR avec `is_shiny=true` et `is_evolved=true`. La contrainte `user_cards_evolved_shiny_ssr_check` impose ce résultat ; ce n’est pas une LR. Recevoir une carte déjà évoluée déclenche aussi ce succès : « Obtain » couvre les deux cas sans inventer de condition d’origine. Le nom technique historique est conservé.

Les récompenses, seuils et fonctions restent strictement inchangés. `complete_achievements` compare la progression au seuil et mémorise le déblocage ; la traduction ne recalcule aucune progression. Le retour arrière ci-dessous restaure le texte effectivement relevé sur le VPS, y compris l’ancien libellé SSR → LR ; cette restauration n’est pas une validation de sa justesse.

## Validation

Contrôles VPS après application : 11 succès et mêmes IDs, 22 textes anglais exacts, conditions et récompenses identiques. Les 149 fonctions publiques et les empreintes des cinq tables joueurs contrôlées restent inchangées dans la transaction d’application. La seconde application en transaction met à jour zéro ligne puis termine par `ROLLBACK` ; l’appel sans authentification à `get_achievements` est refusé avec `AUTH_REQUIRED`.

Le test de migration utilise une base jetable en CI GitHub : conservation des conditions et récompenses, des lignes joueurs et notifications, réapplication idempotente, puis retour arrière. Aucun test existant de règle produit n'est affaibli.

## Retour arrière manuel

À faire uniquement sur décision de Walid, après sauvegarde des onze libellés courants et revue des changements intervenus depuis cette PR. Le SQL ci-dessous restaure seulement les définitions qui correspondent encore exactement aux textes anglais livrés ; les libellés modifiés ensuite restent intacts. Il est idempotent. Il ne retire pas l'entrée de la migration du registre ; un retour durable doit être enregistré dans une nouvelle migration, sans modifier l'historique.

```sql
begin;

update public.achievements as achievement
set titre = translation.old_title, description = translation.old_description
from (values
  ('premier-rituel', 'Premier rituel', 'Ouvrir son premier Regular Pack.', 'First Ritual', 'Open your first Regular Pack.'),
  ('habitude-installe', 'L''habitude s''installe', 'Ouvrir 10 Regular Packs.', 'Getting into the Habit', 'Open 10 Regular Packs.'),
  ('chasseur-yokkai', 'Chasseur de Yokkai', 'Ouvrir 50 Regular Packs.', 'Yokkai Hunter', 'Open 50 Regular Packs.'),
  ('decision-decisive', 'Décision décisive', 'Finaliser son premier Decision Pack.', 'Decisive Choice', 'Complete your first Decision Pack.'),
  ('collection-en-marche', 'Collection en marche', 'Réunir 25 cartes différentes du catalogue.', 'Collection in Motion', 'Collect 25 different cards from the catalog.'),
  ('legende-naissante', 'Légende naissante', 'Obtenir sa première carte LR.', 'A Legend Begins', 'Collect your first LR card.'),
  ('eclat-inattendu', 'Éclat inattendu', 'Obtenir sa première carte Shiny.', 'Unexpected Sparkle', 'Collect your first Shiny card.'),
  ('specialiste', 'Spécialiste', 'Compléter 50 % de n''importe quelle catégorie.', 'Specialist', 'Collect 50% of any category.'),
  ('adjuge', 'Adjugé !', 'Gagner sa première enchère.', 'Going, Going, Gone!', 'Win your first auction.'),
  ('marche-conclu', 'Marché conclu', 'Réaliser son premier échange accepté.', 'Deal Done', 'Complete your first accepted trade.'),
  ('transcendance', 'Transcendance', 'Évoluer une première carte SSR en LR.', 'Transcendence', 'Obtain your first evolved Shiny SSR card.')
) as translation(id, old_title, old_description, english_title, english_description)
where achievement.id = translation.id
  and achievement.titre = translation.english_title
  and achievement.description = translation.english_description;

commit;
```
