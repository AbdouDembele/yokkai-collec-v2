# Messages des erreurs SQL : anglais côté client

Aucune migration ni fonction SQL modifiée. Les exceptions des RPC examinées utilisent déjà des codes stables ; les messages anglais sont choisis par les mappings existants dans lib/data/cards.ts, achievements.ts et profile.ts. Les branches d'autorisation PGRST301/42501, les codes, seuils, mutations et invalidations restent identiques. Une erreur inconnue conserve un repli anglais sûr, sans exposer son texte SQL brut. Le message du délai réseau partagé est également anglais.

Les adapters sociaux marché/échanges/friends/modération/wishlist/mur/share sont déjà anglais sur master et ne sont pas retraduits. Les écrans de jeu, enums, données de catalogue, valeurs techniques et routes ne sont pas modifiés. Les validations locales de fichiers/avatar/bannière et de favoris encore françaises dans ces modules restent dans la zone jeu : elles ne proviennent pas d'une exception SQL.

Les assertions de tests changent seulement de langue. Le test des taux de drop, des droits, des limites et des images reste intact. Un contrôle supplémentaire couvre le repli inconnu, le refus 42501 et l'authentification PGRST301 sans fuite de détails SQL. La règle actuelle de trois copies SSR est conservée textuellement ; la PR UR d'Abdou reste hors périmètre et imposera une relecture avant merge si elle modifie cette règle.
