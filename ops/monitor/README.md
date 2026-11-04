# Monitoring de production

`yokkai-monitor` tourne sur le VPS chaque minute (timer systemd). Il ne
fait que des lectures : charge, mémoire, disque, conteneurs Docker, site et API,
PostgreSQL, sauvegardes locales, erreurs de l'application, fail2ban et pare-feu
Cloudflare.

À chaque passage, il :

1. si `DISCORD_WEBHOOK_URL` est défini, met à jour le message de tableau de
   bord Discord et poste les alertes (apparition, aggravation, résolution).
   Depuis le 3 novembre 2026 le webhook est désactivé : la page admin le remplace ;
2. enregistre une ligne dans `public.ops_monitor_snapshots` : uniquement des
   chiffres et des codes, sans donnée de joueur ni secret. C'est la seule
   écriture en base. Les lignes de plus de 14 jours sont supprimées.

La page `/admin/monitoring`, réservée aux administrateurs, lit ces lignes via
`public.admin_get_ops_monitor(p_hours)` et traduit les codes (anglais/français).

## Fichiers sur le serveur

| Dépôt                                  | Serveur                                        |
| -------------------------------------- | ---------------------------------------------- |
| `ops/monitor/yokkai-monitor`           | `/usr/local/sbin/yokkai-monitor` (root 755)    |
| `ops/monitor/yokkai-monitor.service`   | `/etc/systemd/system/`                         |
| `ops/monitor/yokkai-monitor.timer`     | `/etc/systemd/system/`                         |
| (hors dépôt) `/etc/yokkai-monitor.env` | root 600 : options, webhook Discord facultatif |

Le webhook Discord et les autres réglages restent uniquement dans
`/etc/yokkai-monitor.env`, jamais dans Git.

## Déploiement

Appliquer d'abord la migration `20261103230000_ops_monitor_snapshots.sql` via
`scripts/deploy-migrations.sh`. Sans la table, le script continue de mettre à
jour Discord et signale seulement « snapshot non enregistré » dans le journal.

```sh
sudo install -o root -g root -m 755 yokkai-monitor /usr/local/sbin/yokkai-monitor
sudo install -o root -g root -m 644 yokkai-monitor.service yokkai-monitor.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo /usr/local/sbin/yokkai-monitor --dry-run   # aperçu, aucune écriture
sudo systemctl start yokkai-monitor.service
sudo journalctl -u yokkai-monitor.service -n 20 --no-pager
```

Retour arrière : réinstaller la version précédente du script (la table peut
rester, elle n'est plus alimentée).
