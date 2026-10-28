# Restauration et suppression de compte

## Preuve locale, sans données réelles

Exécuter `node tests/postgres17-deletion-restore.mjs` depuis le dépôt avec Node 22,
les dépendances installées et Docker démarré. Le script crée lui-même un conteneur
`supabase/postgres:17.6.1.136`, sans réseau ni port publié, puis le détruit avec ses
volumes dans un `finally`. Il n'accepte aucune URL de base et ne lit aucun `.env`.
Le dump synthétique reste dans `/tmp` du conteneur ; aucun dump de production
n'est téléchargé. Les migrations existantes sont rejouées sans modification.

Résultat local du 14 octobre 2026 : 134 migrations rejouées, scénario terminé
en 138,6 secondes, 30 tables sans résidu et 47 clés étrangères sans orphelin
dans chacune des deux bases. Les reprises et remboursements uniques passent.
Le transcript complet des SELECT exécutés est collé dans la PR en draft.

Cinq joueurs synthétiques possèdent au total 5 000 Karas, soldes et séquestres
compris. Le joueur supprimé vend une carte avec une mise de 40, a misé 30 chez
autrui, participe à deux échanges en attente, au chat, aux partages,
signalements, blocages et amitiés. Son avatar est une métadonnée synthétique.

Le script vérifie : remboursement de 40 exactement une fois ; retrait de la
mise de 30 et remise de la vente au prix initial avec prolongation ; annulation
des deux offres ; bilan de 4 000 Karas survivants + 1 000 Karas retirés avec le
compte = 5 000. La suppression d'un solde n'est pas un remboursement aux autres
joueurs. Les Karas ne sont donc pas conservés dans la seule somme des soldes
actifs ; ils sont conservés dans ce bilan qui inclut le solde retiré.

Un déclencheur de test lève une exception lors de la suppression du profil,
après les remboursements : toute la préparation SQL est annulée, le journal
commis auparavant reste présent. Après retrait du déclencheur, la reprise
réussit. Une interruption entre préparation SQL et API Storage/Auth est simulée
en répétant la préparation commise ; les soldes restent identiques. La fin du
traitement puis sa répétition sont vérifiées.

Le `pg_dump -Fc` précède la suppression. `pg_restore --exit-on-error` charge une
seconde base : le joueur y existe et le journal y est vide. Le journal exporté
après suppression depuis la première base est ensuite importé dans la seconde.
La réapplication de la préparation et de la suppression ne laisse aucun compte
ni résidu ; les soldes sont identiques à ceux de la première base.

**Limite explicite :** le bootstrap local simule les tables Auth/Storage et cron.
Le test emploie les véritables fonctions SQL applicatives et PostgreSQL, mais
simule uniquement dans ces bases la fin des API par suppression des lignes
Auth/Storage. Il ne prouve ni l'effacement physique de fichiers, ni les sessions
GoTrue/OAuth, ni la révocation de caches. Les tests existants
`tests/account-deletion-server.test.mjs` vérifient l'ordre des appels API.
En exploitation, utiliser le service `deleteAccount` et les API, jamais ces
DELETE de simulation. Aucun test ne constitue une validation de la production.

## Toutes les requêtes de vérification des résidus

Le script imprime chaque requête exacte, avec résultat et nom de base ; conserver
sa sortie complète dans la PR. Pour chaque table de `public`, `auth`, `storage`,
à l'exception du journal, il exécute la requête suivante en substituant son nom :

```sql
SELECT count(*) FROM public.user_profiles t
WHERE position('UUID_SUPPRIME' IN to_jsonb(t)::text)>0
   OR position('Synthetic1' IN to_jsonb(t)::text)>0
   OR position('Synthetic private' IN to_jsonb(t)::text)>0;
```

L'inventaire couvre aussi les champs texte/JSON et les tableaux, et ne dépend pas
d'une liste figée de colonnes. En restauration réelle, rechercher les UUID du
journal ; les marqueurs synthétiques ne s'appliquent pas. Une recherche textuelle
ne détecte pas des données copiées sans UUID ou des citations par un autre joueur :
les signalements liés sont expurgés par la préparation, mais les textes libres
non liés nécessitent une revue selon leur contexte.

```sql
SELECT schemaname, tablename FROM pg_tables
WHERE schemaname IN ('public','auth','storage')
  AND tablename<>'account_deletion_log'
ORDER BY schemaname, tablename;

SELECT count(*) FROM public.account_deletion_log WHERE user_id='UUID_SUPPRIME';
-- Attendu : 1 ; cette trace UUID/date est intentionnelle, restreinte au service.

SELECT coalesce(sum(karas_balance),0)
 + (SELECT coalesce(sum(current_price),0) FROM public.auctions
    WHERE status='active' AND buyer_id IS NOT NULL)
FROM public.user_profiles;

SELECT user_id,karas_balance FROM public.user_profiles ORDER BY user_id;
SELECT count(*) FROM public.trade_offers WHERE status='cancelled';
SELECT buyer_id,current_price,starting_price,status,ends_at
FROM public.auctions ORDER BY id;
```

Le générateur ci-dessous produit **toutes** les recherches de lignes orphelines
sur les clés étrangères, y compris composites. Exécuter chaque SELECT produit ;
chaque résultat doit être zéro. Les références nulles d'historiques anonymisés
sont autorisées et ne constituent pas des orphelins.

```sql
SELECT format(
 'SELECT count(*) FROM %s c WHERE %s AND NOT EXISTS (SELECT 1 FROM %s p WHERE %s);',
 conrelid::regclass,
 string_agg(format('c.%I IS NOT NULL',ca.attname),' AND ' ORDER BY k.i),
 confrelid::regclass,
 string_agg(format('p.%I=c.%I',pa.attname,ca.attname),' AND ' ORDER BY k.i))
FROM pg_constraint
CROSS JOIN LATERAL generate_subscripts(conkey,1) k(i)
JOIN pg_attribute ca ON ca.attrelid=conrelid AND ca.attnum=conkey[k.i]
JOIN pg_attribute pa ON pa.attrelid=confrelid AND pa.attnum=confkey[k.i]
WHERE contype='f'
 AND connamespace IN ('public'::regnamespace,'auth'::regnamespace,'storage'::regnamespace)
GROUP BY pg_constraint.oid,conrelid,confrelid;
```

Les tableaux d'UUID ne sont pas des FK : les instantanés de catalogue des offres
peuvent conserver des identifiants d'instances effacées. Ne pas les confondre avec
des instances actives ; vérifier que ces offres sont terminées et sans identité.

## Procédure de restauration de production (à exécuter sur infrastructure autorisée)

Cette procédure est un runbook, aucune étape n'a été exécutée en production.
Ne jamais restaurer un dump réel sur un poste personnel. Opérer sur une cible
serveur isolée, chiffrée, inaccessible aux utilisateurs et aux tâches planifiées.

1. Fermer les écritures, suspendre cron/workers/webhooks et les accès publics à
   l'application, Auth et Storage. Recenser version PostgreSQL/extensions,
   migrations et sauvegarde Storage correspondante. Vérifier checksum et
   déchiffrement du dump. Sauvegarder l'état actuel avant toute bascule.
2. **Avant toute restauration**, exporter le journal le plus récent avec un
   compte serveur autorisé et le conserver indépendamment du dump sélectionné :
   `COPY (SELECT user_id,deleted_at FROM public.account_deletion_log ORDER BY user_id)
TO STDOUT WITH CSV`. Vérifier son intégrité et sa fraîcheur. Si le journal
   récent est perdu ou incomplet, ne pas rouvrir le service : un ancien dump ne
   permet pas de reconstruire les suppressions postérieures à sa date.
3. Provisionner une instance Supabase compatible. Restaurer les rôles/configurations
   et schémas plateforme selon la procédure de cette version ; `pg_dump` ne
   sauvegarde pas les rôles globaux ni les secrets/configurations des services.
   Restaurer dans une base neuve avec `pg_restore --exit-on-error --dbname=... dump`.
   Ne pas ajouter `--clean` sur une cible existante. Vérifier les propriétaires et
   privilèges ; ne pas ignorer les erreurs. Appliquer uniquement les migrations
   manquantes par le workflow habituel, en particulier celles du journal et des
   RPC de suppression. Ne pas rejouer aveuglément toutes les migrations après dump.
4. Importer le journal externe dans une table temporaire UUID/date puis fusionner
   avec `INSERT INTO public.account_deletion_log(user_id,deleted_at)
SELECT user_id,deleted_at FROM journal_import ON CONFLICT(user_id)
DO UPDATE SET deleted_at=least(account_deletion_log.deleted_at,excluded.deleted_at)`.
   Conserver l'union, sans filtrer selon la date du dump. Aucun ancien journal
   issu de la restauration ne doit remplacer le journal actuel.
5. Pour **chaque UUID de l'union**, appeler le service serveur existant
   `deleteAccount(uuid, clientAdminDeLaCible)` : clôture commise, préparation
   transactionnelle, API Storage puis suppression dure Auth. Utiliser la clé de
   la cible isolée. Le service est interne, sans route publique ; le lanceur
   administratif doit rester côté serveur. Consigner succès/échec par UUID et
   reprendre les échecs ; arrêter la bascule si un seul UUID reste en erreur.
6. Vérifier absence d'UUID dans tous les champs applicatifs et Auth/Storage,
   absence d'orphelins, présence du journal complet, remboursement unique,
   annulation des offres et vente chez autrui réinitialisée. Sur GoTrue, vérifier
   aussi identités, sessions et tokens des UUID supprimés. Vérifier l'absence
   d'objets physiques via API Storage et fournisseur, puis purger caches/CDN.
7. Valider les accès avec un compte autorisé non supprimé et vérifier qu'un
   ancien jeton supprimé ne peut plus écrire. Contrôler ensuite la cohérence des
   enchères échues avant de réactiver leurs traitements. Basculer puis rouvrir
   uniquement après toutes les validations ; ne jamais revenir sur l'ancien dump
   sans réappliquer le même journal.

Durée de planification : prévoir 30–90 minutes pour une petite instance, plus
le temps de transfert et de traitement Storage ; ce n'est pas une mesure de
production. Mesurer sur serveur de préproduction autorisé : restauration =
taille du dump / débit observé + index/FK ; journal = nombre d'UUID × temps
mesuré d'un effacement ; ajouter la validation et une marge de 50 %. La durée
synthétique imprimée par le test ne permet pas d'estimer un dump réel.

## Hors base : avatars, images, sauvegardes et caches

`storage.objects` contient des métadonnées, pas les fichiers. Restaurer les
fichiers d'avatars sur une cible privée **avant** réapplication du journal,
puis les effacer via Storage API, y compris anciennes versions chez le fournisseur.
Ne pas recopier ensuite une sauvegarde Storage non filtrée. Les avatars sous
`UUID/` doivent être retirés même si leur propriétaire metadata est absent.
Le service refuse les objets personnels dans un autre bucket : revue obligatoire
avant reprise, sans effacer automatiquement les images du catalogue global.
Les images de cartes du catalogue restent communes ; les images personnalisées,
fichiers dérivés, rendus de partages, caches CDN et éventuels exports privés doivent
être inventoriés et purgés selon leur ownership réel. Vérifier également copies
VPS, snapshots de volumes, réplications, caches et anciennes versions d'objets.

## Politique de rétention retenue (à mettre en place)

La rétention des sauvegardes de 30 jours est validée par Walid le 14 octobre 2026. Cette validation ne constitue pas une preuve de sa mise en œuvre sur les
serveurs ou chez les fournisseurs de stockage.

- 7 dumps quotidiens, 4 hebdomadaires, tous supprimés au plus tard à 30 jours
  depuis leur création ; pas de copie mensuelle indéfinie. Même plafond pour
  snapshots, versions Storage et réplications de sauvegardes. Éviter les
  différences de fuseau : échéances en UTC.
- Chiffrement avant transfert, en transit et au repos ; clés séparées des
  sauvegardes, accès limité, rotations et journal d'accès. Une copie de secours
  chez un fournisseur européen distinct du VPS, dans un compte privé séparé ;
  copie locale serveur également soumise aux 30 jours. Aucun poste personnel.
- Journal UUID/date restreint au service, répliqué indépendamment avant
  acquittement d'une suppression pour couvrir la perte du VPS. Le code actuel
  ne met pas en place cette réplication : elle est une condition opérationnelle
  à réaliser et vérifier avant de garantir la résistance à un sinistre réel.
  Conserver les entrées tant qu'une sauvegarde peut contenir le compte, puis
  selon la nécessité de bloquer les anciens jetons ; proposer 90 jours avec
  revue avant purge, et jamais tant qu'un dump retenu peut ressusciter ce compte.
- Contrôle quotidien des échéances, alertes sur échec de purge, exercice de
  restauration trimestriel sur serveur autorisé. Une sauvegarde hors ligne
  n'est jamais servie directement : journal réappliqué avant ouverture.

Phrase proposée, **à publier seulement après mise en œuvre et contrôle de cette
politique**, avec N = 30 : « Suppression effective immédiate dans la base active,
copies de sauvegarde purgées sous 30 jours. » En cas d'échec du service, ne pas
annoncer la suppression comme achevée : le journal bloque l'accès, mais la reprise
doit encore terminer l'effacement.
