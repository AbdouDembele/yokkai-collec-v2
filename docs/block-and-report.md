# Blocage et signalement

Migration : `20261008000007_block_and_report.sql`. Instance cible : Supabase de production (VPS).
**Appliquée sur le VPS de production le 8 octobre 2026 (contrôles terminés à 14:18 UTC).** Les tests automatisés utilisent PGlite jetable.

## Confidentialité et portée

Le joueur bloqué peut constater la disparition de l'amitié/demande et les offres en attente annulées.
Il ne reçoit aucune notification de blocage ou d'annulation causée par le blocage, aucun état indiquant
qu'un autre joueur l'a bloqué et aucun message d'erreur nommant le blocage. Les profils et enchères
restent accessibles. Une collection privée peut perdre son accès réservé aux amis après retrait de l'amitié.

Les messages de B sont masqués à A si A bloque B ; les messages de A restent lisibles par B.
Les notifications d'interaction de B vers A sont retirées ; les notifications économiques restent.
Une mention entre joueurs bloqués ne crée aucune notification. Débloquer ne restaure aucune relation/offre.
Les RPC de profil et recherche ne changent pas : le client charge sa propre liste de blocages une fois par page.

## Verrous et limites de validation

- Insertion d'offre : amitié acceptée verrouillée en FOR SHARE ; refus si blocage dans un sens quelconque.
- Acceptation : simple lecture du blocage, aucun verrou amitié/advisory supplémentaire ; la RPC possède le verrou de l'offre.
- Blocage : verrou advisory de paire (pour demandes simultanées sans relation), puis amitié FOR UPDATE,
  puis annulation des offres pending ; suppression de l'amitié et second passage d'annulation.
- Demande/réponse/déblocage : même verrou advisory de paire. Aucun de ces chemins ne verrouille un profil.
- Signalements : verrou advisory par signaleur, séparé de celui des relations ; plafond par jour UTC.
- Une exception concurrente annule toute la transaction ; aucun état partiel ne doit être conservé.

**Concurrence non testée en conditions réelles à deux connexions** : le moteur Docker local est indisponible.
PGlite valide les transactions et comportements séquentiels, pas les attentes de verrous entre connexions.
Risque identifié : une contre-offre existante prend le verrou de l'offre parente avant l'insertion ; sa garde
prend ensuite FOR SHARE sur l'amitié. Un blocage prend ces verrous dans l'ordre inverse. PostgreSQL peut alors
annuler une transaction avec deadlock_detected. Les corps create_trade_offer/respond_trade_offer restent inchangés
sur demande ; ne pas affirmer l'absence d'interblocage de ce chemin sans test réel et décision explicite.

## Vérifications

`node --test tests/block-and-report-db.test.mjs` : SQL réel des RPC sur PGlite jetable,
droits anon, relations, offres des deux sens et tiers, présence, 100 messages filtrés avant LIMIT,
mentions, snapshot serveur, NULLS NOT DISTINCT avec contexte profil NULL, plafond et administration.

Après implémentation UI : lint, TypeScript, tous les tests, build et vrais clics sur les composants réels.
Les preuves de navigateur avec adaptateurs ne remplacent pas les validations RPC de production après déploiement.

## Signalements dans Studio

Ne pas exposer les tables aux joueurs. Les RPC administrateur vérifient auth.uid() via admin_users.
Dans Studio (session privilégiée), remplacer les UUID ci-dessous par celui d'un administrateur existant
et celui du signalement. Ne jamais substituer une identité administrateur dans le navigateur.

```sql
begin;
select set_config('request.jwt.claim.sub', '<UUID_ADMIN>', true);
select set_config('request.jwt.claims', '{"sub":"<UUID_ADMIN>","role":"authenticated"}', true);
set local role authenticated;
select public.admin_list_reports('pending', 50, 0);
rollback;
```

Pour traiter un signalement après lecture :

```sql
begin;
select set_config('request.jwt.claim.sub', '<UUID_ADMIN>', true);
select set_config('request.jwt.claims', '{"sub":"<UUID_ADMIN>","role":"authenticated"}', true);
set local role authenticated;
select public.admin_set_report_status('<UUID_SIGNALEMENT>', 'reviewed');
commit;
```

Statuts : pending, reviewed, dismissed. Pas de notification au signalé ni d'engagement de délai ou sanction.

## Déploiement

1. Présenter le fichier final de migration ; aucun accès SSH/secret dans le dépôt ou la PR.
2. Prévenir le collègue sur Discord et confirmer qu'une seule personne intervient.
3. Instance VPS : vérifier schema_migrations et comparer à nouveau les fonctions remplacées avec les migrations locales.
4. Instance VPS : backup pg_dump, valider avec pg_restore --list.
5. Instance VPS : appliquer la migration en transaction et enregistrer schema_migrations selon la procédure de l'équipe.
6. Instance VPS : trois comptes existants (bloqueur, bloqué, tiers), vérifications dans une transaction puis ROLLBACK.
   Contrôler que les fonctions anon restent exactement is_pseudo_available(text) et get_shared_card(text).
7. Publier le code après la migration. Ancien code compatible avec les signatures existantes ; les nouvelles erreurs
   restent génériques. Une session ancienne du bloqueur peut conserver des données déjà affichées jusqu'à rafraîchissement.
8. PR draft, deux commits (SQL puis UI), statut VPS explicitement mis à jour, aucun merge direct.

## Visibilité des amis : inventaire hors périmètre

Instance VPS, lecture READ ONLY terminée par ROLLBACK le 8 octobre 2026.
Le réglage actuel est user_profiles.is_public, NOT NULL DEFAULT true, partagé avec la confidentialité de collection.
Effectifs anonymes : true=43, false=0. La migration d'introduction a initialisé les lignes existantes à true.
Aucun journal ne permet d'identifier individuellement les joueurs n'ayant jamais changé ce réglage.
get_profile applique côté serveur friends_allowed := viewer=target.user_id OR target.is_public.
Les amis publics contiennent id/pseudo/avatarUrl uniquement, sans isOnline/lastSeenAt.
get_friendships renvoie ces statuts seulement pour les amitiés accepted impliquant auth.uid().
Aucune correction de visibilité dans cette PR.

## Résultat du déploiement SQL

Coordination Discord confirmée avant intervention. Sauvegarde pg_dump validée par pg_restore --list
(1 027 entrées), conservée hors dépôt sur le VPS. Précontrôle : 11 fonctions sans écart de MD5,
registre à jour jusqu'à 20261008000006. Migration et inscription 20261008000007 appliquées ensemble
en transaction, avec délais de verrous bornés. Postcontrôle READ ONLY + ROLLBACK : 16 corps de fonctions
conformes aux migrations, fonctions de profil/catalog/échanges protégées inchangées.

Vérification sur trois comptes existants dans une transaction terminée par ROLLBACK : amitié et demandes
retirées, offres des deux sens annulées et tiers préservé, aucune notification au bloqué, présence retirée,
idempotence et auto-blocage, demandes refusées dans les deux sens, nouvelle demande après déblocage,
chat filtré avant LIMIT 100 et visibilité asymétrique, signalements (doublon profil NULL, auto-signalement,
snapshot, plafond, accès non-administrateur). Accès authenticated contrôlé ; anon conserve exactement
is_pseudo_available(text) et get_shared_card(text). Après ROLLBACK : zéro blocage et zéro signalement.
Le code applicatif n'est pas publié ; PR toujours en draft, aucun merge.
