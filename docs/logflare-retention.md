# Rétention des logs Logflare (analytics Supabase)

> **Désactivé le 2026-11-05.** Les services `supabase-analytics` et
> `supabase-vector` ont été retirés de la production pendant la maintenance,
> et le schéma `_analytics` a été supprimé. Le timer
> `yokkai-logflare-retention.timer` est désactivé sur le VPS. Ne pas le
> réactiver sans remettre analytics en place.

## Pourquoi

Avec le stockage Postgres, Logflare 1.50 ne supprime **jamais** ses logs : il
n'existe aucun réglage de rétention pour ce backend. Le 4 novembre 2026, la
base `_supabase` faisait 20 Go, dont 18 Go de logs Auth (environ 285 000
lignes par jour) et 2,8 Go de logs Storage. Les plus anciens dataient du
25 septembre. Ces logs contiennent des adresses IP et des e-mails, alors que la
politique de confidentialité annonce environ 7 jours de conservation des
journaux serveur (`SERVER_LOG_RETENTION_DAYS` dans `lib/legal/privacy.ts`).

Le même jour, après accord, les deux tables Auth et Storage ont été vidées une
fois (`TRUNCATE`, 20 Go → 68 Mo). Cette purge quotidienne empêche qu'elles se
remplissent de nouveau.

## Ce que fait la purge

`ops/logflare-retention.sql` supprime, dans toutes les tables
`_analytics.log_events_*` de la base `_supabase`, les événements plus anciens
que `RETENTION_DAYS` (7 par défaut, de 1 à 90). Les autres tables de Logflare
et la base du jeu ne sont pas concernées.

Elle ne prend que des verrous de ligne : Logflare continue d'écrire pendant la
purge. Après la première exécution, elle supprime environ une journée de logs
par jour. L'autovacuum réutilise l'espace libéré, donc les tables se stabilisent
autour de quelques Go.

Le script tourne chaque jour à 04:45 (heure de Paris), en dehors du créneau de
nettoyage disque de 03:30. Aucun job pg_cron n'est créé : `_supabase` n'est pas
la base du jeu, et le contrôle de dérive des migrations n'est pas concerné.

## Installation sur le VPS

Depuis l'archive du commit mergé et relu, comme pour le nettoyage disque
(`docs/ops-disk-cleanup.md`) :

```sh
release=/opt/yokkai-ops/revisions/<commit>
sudo install -m 755 "$release/ops/yokkai-logflare-retention" /usr/local/sbin/
sudo install -d -m 755 /usr/local/share/yokkai
sudo install -m 644 "$release/ops/logflare-retention.sql" /usr/local/share/yokkai/
sudo install -m 644 "$release/ops/yokkai-logflare-retention.service" "$release/ops/yokkai-logflare-retention.timer" /etc/systemd/system/
printf 'DB_CONTAINER=%s\nRETENTION_DAYS=7\n' supabase-db-gawq4yyxiise96wens0dt1ex | sudo tee /etc/default/yokkai-logflare-retention
sudo systemctl daemon-reload
sudo systemctl start yokkai-logflare-retention.service   # premier passage, vérifier le journal
sudo systemctl enable --now yokkai-logflare-retention.timer
```

## Vérifier

```sh
sudo journalctl -t yokkai-logflare-retention --since today --no-pager
systemctl list-timers yokkai-logflare-retention.timer
```

Le journal affiche `logflare_retention days=7 cutoff=… removed_total=…`.

## Retour arrière

```sh
sudo systemctl disable --now yokkai-logflare-retention.timer
```

Les logs supprimés ne sont pas récupérables. Les logs récents restent aussi
disponibles via `docker logs`.

## Plus tard

Si personne n'utilise la page « Logs » de Studio, l'analytics (Logflare et
Vector) peut être arrêtée complètement pendant une nuit de maintenance. Il faut
d'abord retirer du compose Coolify les dépendances `supabase-analytics:
service_healthy` (Auth, PostgREST, Envoy, Realtime, Supavisor, Meta, Studio,
edge functions) et `supabase-vector` (base de données), puis supprimer le slot
de réplication `cainophile_…`. Sinon, la stack ne redémarre plus.
