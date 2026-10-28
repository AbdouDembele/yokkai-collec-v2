# Contrôle des comptes bannis (#374, #376)

## Fonctionnement

- `public.assert_player_not_banned(p_user_id uuid)` porte la logique. Si
  `auth.users.banned_until > now()`, elle lève `ACCOUNT_BANNED` (P0001). Elle est
  owner-only et n'est exécutable par aucun rôle d'API.
- `public.assert_player_not_banned()` appelle la version à paramètre avec
  `auth.uid()`. Elle est exécutable par `authenticated` (wrappers SECURITY INVOKER,
  policies Storage).
- Ce contrôle est la **première instruction** de chaque RPC volatile exécutable
  par `authenticated` (migrations `20261026200000`, `20261026235000`). On le
  trouve aussi :
  - dans les policies restrictives d'écriture sur `storage.objects` et
    `panini_album_favorites` ;
  - dans la réservation serveur des médias de profil
    (`guard_profile_media_reservation`, migration `20261027000000`), où le
    paramètre est `new.user_id` parce que l'appel se fait en `service_role` et
    que `auth.uid()` y est nul.
- `tests/banned-account-guard-db.test.mjs` échoue si une fonction mutatrice exposée
  n'a pas le contrôle en première instruction. Toute migration qui redéfinit
  une de ces fonctions (`create or replace`) doit le garder.
- Côté navigateur, une réponse `ACCOUNT_BANNED` déconnecte le joueur et le renvoie
  vers `/login?account=banned`.

## Coupe-circuit (si une RPC casse en prod après application)

Il faut redéfinir **les deux fonctions** : la version sans paramètre seule ne
couvre plus la réservation des médias de profil.

```sql
begin;
create or replace function public.assert_player_not_banned(p_user_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$ begin return true; end $$;
create or replace function public.assert_player_not_banned() returns boolean
language plpgsql stable security definer set search_path = '' as $$ begin return true; end $$;
commit;
```

- Signatures, owners et ACL sont inchangés : aucun nouveau droit n'est ouvert.
  Toutes les RPC, policies et réservations retrouvent alors leur comportement
  sans contrôle de ban.
- Reprendre ensuite exactement ce SQL dans une **nouvelle migration** du dépôt,
  sinon `check-prod-drift.sh` signalera un écart.
- Pour réactiver le contrôle, ajouter une nouvelle migration qui remet les
  définitions de `20261027000000_profile_media_quota.sql`.

## Une seule fonction cassée

Recréer la fonction avec sa définition précédente (le dernier `create or replace`
dans `supabase/migrations/`, ou la sauvegarde prise par `deploy-migrations.sh`) dans
une nouvelle migration. L'ajouter ensuite temporairement, avec un commentaire, à
`unguardedReads` de `tests/banned-account-guard-db.test.mjs`, puis corriger.

## Policies Storage

Si un upload légitime est bloqué, supprimer les policies restrictives via une
nouvelle migration :

```sql
drop policy storage_writes_require_unbanned_insert on storage.objects;
drop policy storage_writes_require_unbanned_update on storage.objects;
```
