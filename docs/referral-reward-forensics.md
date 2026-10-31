# Reconstruction historique des récompenses — deuxième DRY-RUN

Cette extension complète le premier audit sans modifier ses artefacts. Aucun
compte, inventaire, solde, trade, enchère ou état de notification n’est modifié.
Aucune migration ni activation de popup n’est incluse.

## Flux réel

`components/game.tsx`, fonction `open`, appelle `openBooster` ou `openBoosters`
dans `lib/data/cards.ts`. Le navigateur authentifié appelle directement PostgREST
avec `open_regular_pack` ou `open_regular_packs(p_count)`. Ce n’est pas la route
Next `/api/booster-opening` : celle-ci fournit seulement le document d’animation.
Il n’existe pas d’Edge Function intermédiaire dans ce parcours.

Une RPC de lot appelle la fonction unitaire dans une seule transaction. La
fonction synchronise le timer, verrouille le profil, lit le compteur bonus,
capture `server_now=clock_timestamp()`, sélectionne cinq cartes et génère cinq
UUID. Les cinq instances sont insérées avec le même `date_obtention=server_now`.
Le compteur bonus est décrémenté en priorité ; le timer reste inchangé dans ce
cas. Sans bonus, le timer de la réserve est consommé. Le compteur statistique
des ouvertures est incrémenté. Le verrou reste détenu jusqu’à la fin du lot.
Un échec annule tout le lot ; le client ne retente pas automatiquement la mutation.

Les limites Basic/Pro, la recharge, le timer initial et les changements de
rythme historiques doivent être lus dans les versions réellement déployées.
Les recharges temporelles ne créent pas d’événement par pack. Le bonus de taux
des premiers tirages change les probabilités, pas le nombre ou la source des packs.

Les crédits bonus du code audité viennent des affiliations vérifiées, tant
comme parrain que comme filleul, y compris les affiliations légitimes. Ces
origines partagent le même compteur. Le code de packs/paiements ne doit pas être
interprété comme une vente de bonus simplement à partir d’un commentaire : seuls
les chemins d’écriture réellement trouvés font foi. Une intervention SQL manuelle
d’un opérateur n’est pas un événement économique journalisé par ce système.

## Sources et limites temporelles

Les sources à inventorier sont les archives pg_dump, les tables métier et leurs
snapshots, Auth, les logs Docker/Envoy/PostgREST, Traefik, Vector/Logflare,
PostgreSQL et la rétention WAL. Lire uniquement les champs nécessaires. Ne jamais
exporter de clés, mots de passe, adresses complètes, IP ou headers d’authentification.
Ne pas réactiver une collecte ni modifier les réglages de journalisation.

`pg_restore --data-only --file=-` lit un dump en sortie texte ; sans connexion de
restauration, il n’écrit rien dans une base. Le filtrage des comptes/instances se
fait avant l’export hors VPS. Conserver le SHA-256 de chaque archive, son en-tête,
la liste des colonnes COPY et les lignes utiles. Les fonctions SQL archivées
permettent de vérifier les règles historiques, pas seulement le code actuel.

- Un access log prouve au mieux un appel, un statut et une heure ; sans sujet
  authentifié et résultat, il ne nomme pas les cartes d’un joueur.
- Un compteur agrégé n’est pas un historique d’ouvertures.
- `date_obtention` est remplacé par un transfert : ce n’est pas toujours la
  naissance de la copie. Le journal de trades peut conserver ses identifiants
  alors que les cartes ont disparu ; les snapshots existants peuvent aussi
  volontairement omettre la date d’obtention.
- `auctions.ends_at` est une échéance, pas l’heure réelle du crédit Kara. Une
  notification de vente peut dater la transaction enregistrée ; ne pas la
  rebaptiser heure exacte du commit ou du mouvement de portefeuille.
- Une suppression de compte peut supprimer ses lignes d’affiliation par
  cascade. Vérifier les journaux de suppression, les lignes présentes dans les
  checkpoints et les inscriptions OAuth encore incomplètes avant d’affirmer
  que toutes les sources de bonus sont connues.

## Fenêtre fermée et reconstruction stricte

`scripts/referral-forensic-reconstruction.mjs` est un outil hors ligne, sans
connexion SQL, réseau, mode APPLY ou autorisation de sanction. Il exige :

1. Deux snapshots cohérents et authentiques avec le profil, les compteurs
   d’ouvertures et les instances, et les hashes des archives de preuve.
2. La vérification des règles historiques : cinq instances par ouverture,
   compteur bonus prioritaire, verrouillage et absence de reset des compteurs.
3. L’historique complet des sources de bonus de la fenêtre, y compris les
   crédits reçus comme filleul et les affiliations permanentes. Les suppressions
   et les validations tardives OAuth doivent être exclues ou expliquées.
4. L’identification des cartes nouvellement reçues par trade ou achat pour les
   exclure des nouvelles créations. Les autres créateurs sont audités :
   Decision Pack et évolutions, ainsi que leurs compteurs/marqueurs.
5. Exactement cinq instances candidates pour chaque ouverture supplémentaire
   du compteur, groupées par timestamp PostgreSQL exact. Ni groupe incomplet,
   ni ouverture manquante, ni carte évoluée, ni timestamp ambigu ou hors fenêtre.
6. Un replay qui retrouve exactement le solde bonus final observé. Le bonus
   est consommé avant la réserve, indépendamment de sa disponibilité simultanée.

Les timestamps restent à la microseconde. Les convertir en millisecondes peut
fusionner des tirages et invalider la chronologie. Une égalité de timestamp
entre crédit et ouverture sans ordre démontrable fait échouer la preuve.

Le replay sépare les crédits du périmètre étudié et les autres crédits. Un pool
mixte ou préexistant non attribué n’est jamais affecté aux affiliations par
un FIFO inventé. Si toutes les origines possibles d’un bonus sont du périmètre,
la provenance peut être `PROVEN` pour les instances exactes d’une ouverture
entièrement reconstruite. Si plusieurs affiliations de ce même périmètre ont
été mélangées, `sourceReferralId` reste nul et `possibleSourceReferralIds`
contient l’ensemble des sources possibles. Ne pas affecter les cinq premières
cartes à la première affiliation ni compter plusieurs fois les mêmes cartes.

Si les conditions ne sont pas toutes réunies, aucune preuve automatique n’est
produite. Les candidats et les contrôles ayant échoué restent visibles.
`HIGH_CONFIDENCE` garde une incertitude de source et nécessite une revue humaine ;
`POSSIBLE` et `UNVERIFIED` n’autorisent aucune sanction économique. Un identifiant
`forensicOpeningId` est une clé du dossier, explicitement distincte d’un identifiant
de pack en base, qui n’existe pas rétrospectivement.

Ces conclusions reposent sur les archives et chemins applicatifs vérifiés.
Elles ne constituent pas une preuve cryptographique contre une falsification
des sauvegardes ou une manipulation SQL manuelle non journalisée par un
administrateur de confiance. Exposer toute lacune de ce type dans le dossier.

## Ledger et propositions

Le ledger privé conserve pour chaque instance : UUID, carte catalogue, rareté,
date observée, date de naissance seulement si reconstruite, propriétaire initial
si démontré, propriétaire actuel, sources possibles, preuves, confiance, historique
de ventes/trades et action proposée. Les cadeaux d’un filleul sont une branche
distincte : ses propres récompenses ne font pas partie des crédits au parrain.
Ne pas additionner ces deux périmètres.

Le tableau par affiliation distingue les liens directs des ensembles de sources
partagées. Les totaux globaux sont dédupliqués par UUID ; aucun nombre théorique
de cartes manquantes ne devient une liste inventée d’actifs.

La preuve de provenance économique ne prouve pas, à elle seule, que le parrain
contrôlait le compte filleul. Un cas isolé ne devient pas une fraude manifeste.
Pour les instances PROVEN, conserver les actifs de tout tiers présumé innocent.
Ne proposer que le produit historique réellement reçu par le bénéficiaire,
jamais la valeur actuelle. Ne pas créer de dette ou de solde négatif.

Toutes les propositions restent conditionnées à une approbation après lecture,
à un relevé rafraîchi, une sauvegarde restaurable et un journal d’APPLY. La
notification future prend ses chiffres dans ce journal committé ; les chiffres
du ledger DRY-RUN ne créent ni sanction ni popup.

## Provenance future, sans réécriture rétroactive

Une future PR peut ajouter, de façon additive et sans backfill de preuve fictive :

- `reward_events` : source stable, affiliation, bénéficiaire, quantité, date,
  contrainte d’idempotence par source et bénéficiaire.
- `pack_instances` : UUID, propriétaire, `source_type`, `source_id`, état,
  `opened_at`, `opened_by`. Chaque attribution bonus crée des instances précises.
- `pack_openings` : pack, joueur, date serveur, clé d’idempotence de requête,
  lot parent et résultat. Les ouvertures temporelles matérialisent leur pack
  dans la transaction, sans créer des millions de lignes de recharge anticipées.
- `card_origin` ou `user_cards.source_pack_instance_id` nullable : lien immuable
  vers l’instance de pack ; les anciennes cartes restent `LEGACY_UNVERIFIED`.
  Un ledger séparé conserve cette origine après destruction et transfert.
- Un journal des transferts et des mouvements Kara : montants, contreparties,
  instance, transaction et horodatage effectif ; pas de secret ou d’e-mail.

Crédit, réservation/ouverture du pack, insertion des cinq copies, compteur et
événement économique doivent être atomiques et verrouillés dans un ordre stable.
Les retries réutilisent une clé d’idempotence. Le choix de lots bonus est
explicite pour les nouveaux packs, pas inféré pour les anciens. Les origines
historiques survivent aux suppressions de compte via identifiants minimisés et
une politique de conservation administrative appropriée.

Aucun joueur ne peut lire les origines privées d’un autre, modifier la source
d’une carte, écrire un événement ou falsifier une ouverture. Les RPC exposent
seulement le résultat utile au joueur ; les tables d’enquête restent privées.
Les droits et la stratégie de compatibilité seront revus dans cette future PR.

**Migrations de ce lot : aucune. Écritures en production : aucune.**
