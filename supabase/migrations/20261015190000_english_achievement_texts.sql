begin;

-- Display text only: keep achievement IDs, conditions, rewards and player rows unchanged.
update public.achievements as achievement
set titre = translation.title, description = translation.description
from (values
  ('premier-rituel', 'First Ritual', 'Open your first Regular Pack.'),
  ('habitude-installe', 'Getting into the Habit', 'Open 10 Regular Packs.'),
  ('chasseur-yokkai', 'Yokkai Hunter', 'Open 50 Regular Packs.'),
  ('decision-decisive', 'Decisive Choice', 'Complete your first Decision Pack.'),
  ('collection-en-marche', 'Collection in Motion', 'Collect 25 different cards from the catalog.'),
  ('legende-naissante', 'A Legend Begins', 'Collect your first LR card.'),
  ('eclat-inattendu', 'Unexpected Sparkle', 'Collect your first Shiny card.'),
  ('specialiste', 'Specialist', 'Collect 50% of any category.'),
  ('adjuge', 'Going, Going, Gone!', 'Win your first auction.'),
  ('marche-conclu', 'Deal Done', 'Complete your first accepted trade.'),
  ('transcendance', 'Transcendence', 'Obtain your first evolved Shiny SSR card.')
) as translation(id, title, description)
where achievement.id = translation.id
  and (achievement.titre, achievement.description)
    is distinct from (translation.title, translation.description);

commit;
