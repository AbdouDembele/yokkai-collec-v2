# Audit de fraude au parrainage — procédure en lecture seule

Cette PR prépare uniquement un DRY-RUN. Elle ne contient aucune migration, aucun
ban, retrait d’actif, débit de Kara, notification ou déploiement. Les dossiers de
production et les propositions nominatives restent hors du dépôt public.

## Sources réellement disponibles

Le relevé du 31 octobre 2026 porte sur le schéma après la migration
`20261031170000_disposable_signup_policy.sql`. Les définitions des fonctions en
production ont été lues, puis comparées aux migrations et au code.

- `referral_codes` associe un code à un joueur ; `referrals` conserve `code_id`,
  `referrer_id`, `referred_id`, `created_at`, `verified_at`, `rewarded_at` et
  `reward_packs`. Le trigger de création du profil et celui de confirmation
  enregistrent/vérifient le lien.
- `complete_referral_after_verification` crédite le compteur
  `user_profiles.bonus_regular_packs` et marque `rewarded_at` dans la même
  transaction. La version actuelle crédite aussi le filleul. Le registre ne
  conserve pas une attribution distincte par destinataire : ne pas doubler
  automatiquement les crédits historiquement démontrés au parrain.
- `open_regular_pack` consomme le compteur bonus en priorité, produit cinq
  `user_cards`, puis incrémente `user_achievement_stats.regular_packs_opened`.
  Il ne persiste ni identifiant de Regular Pack, ni ligne d’ouverture, ni lien
  entre crédit de parrainage et instance de carte. `decision_packs` concerne un
  autre produit : ses identifiants ne remplacent pas ce lien manquant.
- `user_cards.id` identifie une copie. `date_obtention` est remplacé lors des
  ventes/trades et ne permet pas de retrouver son premier tirage. Une destruction
  supprime la ligne, sans journal économique unifié.
- `auctions` conserve vendeur, acheteur, instance et prix. Le statut `sold`
  atteste le règlement ; `settle_expired_auctions` crédite `current_price` au
  vendeur. Un prix d’enchère active n’est pas un gain réalisé. La clôture prévue
  `ends_at` n’est pas un horodatage exact du règlement.
- `trade_offers` accepté conserve les deux listes d’instances et les deux
  montants Kara. Une offre en attente/refusée n’est pas un transfert réalisé.
- `credit_karas` et `debit_karas` modifient le solde sans ledger détaillé.
  `user_profiles_karas_nonnegative` et `debit_karas` interdisent un solde négatif.
- `auth.audit_log_entries` permet de contrôler les domaines historiques de
  signup. L’export extrait seulement les domaines, jamais `actor_username`
  entier, mots de passe, tokens, contenu de messages ou IP.

Une attribution bonus enregistrée est une preuve de crédit ; elle ne prouve pas
à elle seule le contrôle du compte filleul par le parrain. Un domaine jetable,
une IP commune ou une proximité temporelle isolée ne suffisent pas à un ban.

## Collecte et reproductibilité

`scripts/sql/referral-fraud-dry-run.sql` utilise **exactement**
`is_disposable_email` et `signup_email_domain`, avec l’allowlist et les règles
déployées. Exécuter exclusivement comme opérateur autorisé, avec :

```sql
begin isolation level repeatable read read only;
set local statement_timeout = '20s';
set local lock_timeout = '1500ms';
-- contenu de scripts/sql/referral-fraud-dry-run.sql
rollback;
```

Imposer aussi `default_transaction_read_only=on` au niveau de la connexion.
Stocker le résultat dans une enveloppe JSON privée :
`{"readOnly":true,"capturedAt":"…","data":<résultat>}`. Le SQL ne fait que
des SELECT et appelle seulement les fonctions de normalisation/lookup stables.
Il ne faut surtout pas appeler une RPC métier de listing qui réglerait des
enchères en arrière-plan.

Les comptes retenus sont les comptes **existants** dont l’adresse actuelle
correspond à la politique. Les événements d’inscription apportent une preuve
historique supplémentaire. Les comptes supprimés et ceux ayant changé vers un
domaine permanent ne sont pas exhaustivement reconstitués par cette collecte.
Une seconde enquête historique nécessiterait un périmètre distinct.

La collecte inclut les affiliations des acteurs, leurs instances actuelles,
les instances mentionnées dans leurs ventes/trades et les transactions
ultérieures observables pour ces mêmes identifiants. Elle ne propage aucune
« contamination » à tout l’inventaire d’un partenaire de trade. Une instance
absente aujourd’hui est `UNKNOWN`, pas automatiquement « détruite » : nettoyage
du catalogue et autres suppressions restent possibles.

Le fichier privé de revue contient un objet par parrain examiné :
`user_id`, `level` (`LOW_SUSPICION` ou `HIGH_SUSPICION`), `reason`. Les niveaux
sont argumentés dans le rapport de l’opérateur à partir des cohortes observées,
sans seuil automatique de bannissement. Aucune déduction de fraude manifeste
n’est autorisée dans ce modèle privé de filiation des packs.

```sh
node scripts/referral-fraud-dry-run.mjs \
  /chemin/prive/snapshot.json /chemin/prive/reviews.json \
  .tools/referral-fraud-private
```

Le script est hors ligne et n’a **aucun mode APPLY**. Il écrit un résumé, les
dossiers, les observations d’instances, le graphe, un CSV et le plan proposé.
La sortie est limitée au dossier ignoré `.tools` de ce checkout. Garder ces
fichiers privés ; ne jamais les joindre à une PR publique ni à des logs CI.

`apply-plan.json` contient les identifiants exacts candidats, leurs avant-images,
des identifiants d’opérations déterministes et les SHA-256 des données/revues.
Il est volontairement non exécutable : une nouvelle approbation après lecture
du rapport et un export rafraîchi sont indispensables.

## Limite décisive et restitution

Sans provenance pack → carte, tous les actifs observés portent
`provenance: UNVERIFIED`, `fraudStatus: UNKNOWN`, `proposedRemoval: false`.
Les quatre statuts métier demandés ne seront attribués à une carte frauduleuse
qu’après preuve de son origine. L’actuel propriétaire et les ventes/trades
observés restent consultables séparément dans le dossier.

Le total de ventes est un **contexte économique**, jamais une dette. Une valeur
inconnue est `null`, pas « zéro fraude ». Le recouvrement exécutable est zéro
tant qu’une vente n’est pas reliée à une carte provenant d’un pack démontré
illégitime. Ne jamais utiliser la valeur actuelle d’une carte, l’ordre des
tirages, une date similaire ou un FIFO inventé pour combler les données manquantes.

Un trade entre deux comptes à examiner ne prouve pas que toutes les cartes
échangées sont frauduleuses. Chaque côté est étudié indépendamment. Les
destinataires innocents gardent leurs cartes, Kara et accès ; aucune popup ne
leur est destinée.

## Plan d’une future phase APPLY, soumis à approbation

1. **Geler le manifeste approuvé.** Conserver hash, version du code, opérateur,
   date, raison et pièces. Rafraîchir les données ; arrêter si les avant-images
   ou le périmètre ont changé, sans élargir automatiquement la liste des comptes.
2. **Sauvegarder avant toute écriture.** Dump complet sur le VPS en répertoire
   root/700, archive vérifiée, puis répétition de restauration isolée. Extraire
   les avant-images exactes des utilisateurs, profils, instances, affiliations,
   enchères, bids, watchers, notifications, offres et états de sessions affectés.
   Une simple sauvegarde dont on ne sait pas restaurer les lignes ne suffit pas.
3. **Journal privé propriétaire uniquement.** Préparer une migration distincte,
   non appliquée ici, avec un dossier/opération unique et les champs :
   `sanction_id`, `operation_id`, `user_id`, `reason_code`, `source_referral_ids`,
   `source_disposable_ids`, `booster_ids`, `instance_ids`, `transaction_ids`,
   `kara_adjustment`, `before_image`, `after_image`, `applied_at`, `status`,
   `operator_id`, `snapshot_hash`. Les IDs manquants restent absents, jamais inventés.
   Chaque correction possède sa propre ligne ; ne pas écraser une sanction.
4. **Phase 1 : désactiver seulement les secondaires approuvés.** Conserver les
   utilisateurs Auth. Le mécanisme existant est `admin_set_user_ban`, avec
   `banned_until` et invalidation des sessions. Attention : cette RPC supprime
   certaines enchères/bids et rembourse des fonds. Ne pas l’exécuter en boucle
   sans sauvegarde, garde des avant-images et revue des effets secondaires.
   Si les candidats ont toujours zéro enchère active, zéro bid et zéro trade
   pending, exiger ces préconditions dans la transaction. Sinon arrêter et
   préparer une variante qui préserve l’historique, sans supprimer des preuves.
5. **Phases 2–3 : cartes et Kara.** Les listes d’opérations sont vides dans ce
   DRY-RUN faute de filiation. Si des preuves nouvelles apparaissent, nouvelle
   revue : verrouiller instance et profil, vérifier propriétaire et état exact,
   exclure les innocents, débiter uniquement les gains historiques prouvés.
   Calculer disponible/manquant ; refuser tout solde négatif et toute dette
   implicite. Ne pas supprimer une ligne de transaction historique.
6. **Phase 4 : trades.** Étudier les deux côtés. Aucun débit ou retrait sur la
   seule base d’un lien social avec un compte suspect. Verrouiller les objets
   dans l’ordre du projet ; ne pas réécrire un trade accepté.
7. **Phase 5 : comptes principaux.** Le plan sûr propose seulement les flags
   internes argumentés ; pas de ban principal automatique. Un flag de revue
   n’est pas une sanction appliquée et ne déclenche aucune popup.
8. **Phase 6 : intégrité.** Transaction, clé d’idempotence, vérification des
   lignes affectées, avant/après exacts, aucun innocent modifié, pas de solde
   négatif, contraintes/FK intactes, aucune récompense recalculée, aucun actif
   retiré deux fois. Échec = rollback de la transaction complète.
9. **Phase 7 : rapport et notification.** Seulement après commit réel. Publier
   les totaux effectivement exécutés, pas ceux du plan. Pas d’e-mail, push ou
   popup pendant la préparation.

### Rollback

Restaurer uniquement les opérations journalisées, en ordre inverse, après
comparaison de l’état actuel à leur `after_image`. Tout mouvement intervenu
depuis impose une revue ; ne jamais écraser le nouvel inventaire/solde d’un
innocent ou rejouer un remboursement. Restaurer un état de ban antérieur,
pas simplement « unban ». Les sessions invalidées ne sont pas réactivées :
le joueur devra se reconnecter. L’historique de sanctions reste conservé et
marqué `REVERSED`. Les reçus d’acquittement restent des preuves historiques.

## Popup obligatoire après sanction réelle

Le système `notifications` existe, mais ne possède pas de type sanction, de
bilan de correction, ni d’acquittement obligatoire. `read_at` signifie seulement
« lu ». La popup d’actualités utilise une receipt d’annonce et peut être
acquittée côté client : elle ne convient pas comme journal de sanctions.
`admin_audit_logs` reste un journal administratif, sans accès au joueur.

Proposition pour la future migration, **aucune table créée ici** :

- Un journal privé de sanctions et de corrections comme ci-dessus ; un résumé
  joueur immutable ne contient que son `sanction_id`, motif stable, type,
  `cards_removed`, `kara_removed`, `applied_at` et statut.
- Une ligne de notification par sanction appliquée, créée dans la même
  transaction que les corrections. Une transaction annulée ne produit pas de
  notification. Les changements de flags internes n’en produisent pas non plus.
- Une lecture authentifiée limitée au joueur courant, aux sanctions `APPLIED`
  non acquittées, sans identifiants d’autres joueurs ni pièces d’enquête.
  Aucun accès direct en écriture aux compteurs, statuts et sanctions.
- Une RPC d’acquittement ne reçoit que `sanction_id` et vérifie `auth.uid()`
  côté serveur. Elle fait un `notification_seen_at=coalesce(notification_seen_at,
clock_timestamp())` pour **ce joueur seulement**, jamais de DELETE.
  Pas de paramètre utilisateur libre ; aucun acquittement d’un dossier pending.
- Une popup par sanction, affichée à la prochaine session/ouverture, dans l’ordre
  d’application. Seul le bouton « J’ai compris » persiste l’acquittement.
  Un échec réseau laisse la popup en attente. Mobile et clavier accessibles,
  focus piégé puis restauré ; pas de bouton décoratif contournant l’acquittement.
- Compte banni : conserver le refus `user_banned`/`ACCOUNT_BANNED`, sans
  réactivation. Une explication personnalisée pré-auth ne doit ni révéler
  l’existence d’une sanction à partir d’un simple e-mail ni exposer d’autres
  comptes. À défaut de preuve d’authentification utilisable, conserver le message
  de suspension générique existant, puis définir un canal sécurisé de recours.
- Ne pas détourner le Web Push existant pour notifier involontairement les
  sanctions. Pas d’envoi de push dans ce lot ; seules les sanctions appliquées
  et approuvées peuvent produire la popup demandée.

### Texte français exact proposé pour un retrait réellement effectué

**Sanction pour exploitation du système d’affiliation**

Nous avons détecté une utilisation abusive du système d’affiliation de Yokkai
impliquant la création de comptes avec des adresses e-mail temporaires ou
jetables afin d’obtenir des récompenses d’affiliation.

Les récompenses et gains identifiés comme provenant de cette exploitation ont
été retirés de votre compte.

**Sanction appliquée**

Cartes retirées : **{cardsRemoved}**

Kara retirés : **{karaRemoved}**

Motif : Utilisation abusive du système d’affiliation via des comptes utilisant
des adresses e-mail jetables.

L’exploitation de mécanismes permettant d’obtenir artificiellement des
récompenses est contraire aux règles de Yokkai. En cas de récidive ou de nouvelle
tentative de contournement, des sanctions supplémentaires pouvant aller jusqu’à
la suspension définitive du compte pourront être appliquées.

**J’ai compris**

Ce texte n’est pas diffusé et ne convient pas à un simple flag ni à un retrait
zéro/zéro : il annoncerait faussement une récupération. Si une sanction distincte
sans retrait est retenue, faire valider un texte correspondant à cette sanction.
L’implémentation ultérieure passera par les catalogues anglais source/français,
avec paramètres ICU, aucune identité tierce, règle de détection ou IP.

## Prévenir les lacunes à l’avenir

Dans une PR distincte, journaliser chaque crédit de récompense et chaque
ouverture, ses packs sources et les instances créées ; préserver un ledger des
transferts, évolutions, destructions et mouvements Kara. Cela améliorera les
preuves futures sans inventer rétroactivement celles qui manquent aujourd’hui.

## Vérifications

Les nouveaux tests gardent les actifs innocents, refusent la dette inventée,
excluent les comptes non examinés/admin et les affiliations non récompensées,
vérifient les avant-images et l’absence d’APPLY/notification active. Aucun test
existant ni droit SQL n’est modifié. CI complète sur GitHub uniquement.

**Migrations de cette PR : aucune. Écritures en production : aucune.**
