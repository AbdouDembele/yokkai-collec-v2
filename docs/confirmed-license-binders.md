# Classeurs par licence confirmée

Le 25 octobre 2026, le propriétaire a précisé le contrat produit : **une licence confirmée = un classeur**, quelle que soit la provenance des cartes. Il a explicitement autorisé les imports manuels et les cartes de provenance incertaine à rejoindre visuellement ce classeur. Cette décision remplace leur ancien verrouillage d'affichage ; tous leurs champs sources, UUID et liens restent protégés.

Naruto et Naruto: Shippuden doivent donc être affichés dans Naruto lorsqu'ils appartiennent à la licence confirmée Naruto. Bleach ne doit pas être doublé d'un classeur « Original binder ». Les titres sources des cartes restent intacts. Les séparations expressément approuvées (Tokyo Ghoul / Tokyo Ghoul:re, parties majeures de JoJo, séries Yu-Gi-Oh!, ONE PIECE in LOVE et RILAKKUMA 2026) restent applicables.

## Architecture additive

`20261025040000_confirmed_license_binders` ajoute des identités, règles de licences exactes, règles médias et exceptions, alias et redirections de clés. Ces tables globales privées sont sous RLS ; aucun joueur ne peut les lire ou les modifier directement. Les RPC bornés et leurs ACL restent identiques. Les correspondances sont préparées séparément avec un reçu portant l'empreinte du mapping et l'autorisation du changement d'affichage des cartes manuelles. Aucun rapprochement de préfixes n'est exécuté dans l'application.

La projection active choisit une exception média vérifiée, puis la licence confirmée du lien source, puis le média vérifié en secours. Une licence secondaire garde son propre lien et peut rejoindre le classeur confirmé correspondant. Les compteurs utilisent les UUID distincts pour ne jamais doubler une carte possédant plusieurs liens vers le même classeur.

Les tables de provenance et le mapping V3 original ne sont pas écrasés. Le mode précédent reste disponible pour un retour arrière et pour les tests historiques. Les assertions existantes sur son comportement sont conservées ; de nouveaux tests couvrent explicitement le contrat par licence, dont les cartes manuelles, incertaines et protégées.

## Favoris et profils

Les anciennes clés de classeurs fusionnés sont résolues à la lecture. Les favoris positifs sont réunis ; un choix effectué après regroupement est enregistré dans la nouvelle colonne nullable `license_favorite`, sans écraser la valeur historique `favorite`. L'export existant inclut automatiquement cette colonne. Aucune réinitialisation ni suppression de préférence n'est nécessaire.

Les widgets historiques gardent leur JSON enregistré ; la lecture traduit les clés et déduplique les entrées qui correspondent désormais au même classeur. Un ancien favori portant une licence confirmée trouve directement son classeur. Seuls les véritables cas encore ambigus demandent un choix. Les badges techniques « Original binder » et « Series binder » sont retirés de l'interface ; un éventuel choix ambigu affiche des informations utiles, comme la catégorie et le nombre de cartes.

## Imports futurs et réversibilité

Le RPC AniList conserve son insertion seule et ses preuves, sans écraser une carte existante. Une carte portant une licence déjà confirmée rejoint le même classeur quel que soit son média ou sa provenance. Une nouvelle exception indépendante exige une règle vérifiée ; les titres ressemblants ne créent pas de correspondance automatique.

Le chargement du seed garde `license_grouping_enabled=false`. L'activation de cette couche nécessite aussi `anime_series_settings.enabled=true`, le flag applicatif existant et une autorisation de production. `license_mapping_version` entre dans la version exposée par les RPC pour invalider les résultats précédents.

Pour revenir au mode précédent, désactiver seulement `license_grouping_enabled`. Les données, choix récents, sources, preuves et anciennes préférences restent conservés. La désactivation du flag SQL principal conserve le retour aux classeurs sources décrit dans `stable-binders-integration.md`.

La recette complète peut être relancée avec `scripts/rehearse-stable-binders.mjs`, ses arguments habituels et les deux fichiers privés `--license-mapping` / `--license-seed`. Elle teste d'abord intégralement le mode historique, puis les ensembles d'UUID de tous les classeurs du nouveau mode, les comptes, l'intégrité et le retour arrière. Les contrôles complets de CI restent exécutés uniquement par GitHub Actions.
