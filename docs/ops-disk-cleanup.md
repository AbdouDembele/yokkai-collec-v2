# Nettoyage automatique du disque

## Résultat du premier passage réel

Le 15 octobre 2026, dry-run manuel réussi à 13:10 UTC, liste vérifiée puis apply
sur la même empreinte, terminé à 13:14:48 UTC. Version exécutée : `552ba3db`,
revue indépendante et CI GitHub vertes. Aucun volume, réseau, base active ni
journal de suppression de comptes touché. Aucun conteneur redémarré.

| Catégorie          | Résultat                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Image application  | Une image ancienne supprimée, 3 281 511 018 octets logiques ; couches partagées, pas un gain physique attribuable |
| Cache Railpack     | 34 références retirées, 8 616 991 142 octets d’inventaire ; buildctl annonce 8,62 Go                              |
| Sauvegardes SQL    | 10 dumps excédentaires, 321 528 162 octets ; sept quotidiennes conservées, dernière incluse                       |
| Conteneurs arrêtés | Aucun candidat, aucune suppression                                                                                |
| Disque réel        | 14 → 25 Gio libres ; 82 → 66 % occupés ; 12 087 029 760 octets récupérés, environ 11,3 Gio                        |

Avant/après exact : disponibles 14 035 312 640 → 26 122 342 400 octets ;
utilisés 61 749 858 304 → 49 662 828 544, capacité 79 048 540 160.
Docker : 27 → 26 images (23,8 → 20,64 Go logiques), 22 conteneurs actifs,
14 volumes présents (contenu 25,64 → 17,5 Go). Les volumes n’ont pas été retirés.
Cache restant : 12 références / 1 938 229 197 octets, sous le plafond souple.
Les tailles Docker/BuildKit et le gain de df ne sont pas additives.

Après : 22 conteneurs running ; toutes les sondes présentes healthy ; PostgreSQL
accepte les connexions, aucune erreur critique nouvelle détectée. Accueil,
connexion, inscription : 200 publiquement et directement dans l’application.
Dernière sauvegarde conservée : `pg-dump-postgres-1792022407.dmp`.
Image supprimée : tag applicatif `741a5fbffa85e4741bc88a1e73a4f793bf5a3418`,
créée le 14 octobre à 16:58:14 UTC ; ID `13d3f5a6cab4…`.
Dumps retirés : dates UTC du 30 septembre au 8 octobre, doublon du 30 inclus.
Les noms, dates, tailles et motifs sont conservés dans le journal JSON privé.

Le dry-run avait prouvé : aucun volume candidat, aucune image candidate utilisée
par un conteneur, aucun journal de suppression candidat, dernière sauvegarde exclue.
Courante `097cb1fa9a2d…`, rollback observé `3b181eec399f…` et trois dernières
images conservés. Le pin n’a pas été changé artificiellement : il suit les versions
précédemment observées saines.

Décision finale de Walid : **pas de Discord**. Le code d’envoi et le prérequis
Discord sont retirés. Deux STOP consécutifs génèrent une alerte locale de niveau
error dans journald, avec noms concernés ; aucune notification externe.
Walid a confirmé la désactivation de la purge native Coolify dans l’interface.
Le serveur reçoit la version du dépôt, jamais une variante corrigée à la main.

## Risque accepté pendant la bêta

Sauvegardes uniquement sur le serveur : perte possible des données joueurs et de
leurs copies en cas de perte du disque. Aucune copie extérieure n’est exigée pour
la rétention locale validée. Avant lancement public : copie chiffrée hors serveur
et restauration d’essai. Une archive lisible ne remplace pas un test de restauration.

## Ce que chaque règle supprime et protège

| Catégorie       | Cible autorisée                                                                                       | Protections                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Images          | IDs du seul dépôt `lbugcql3gc8ijtbv7qqy70do`, sans force                                              | Trois dernières + courante + rollback, toute image référencée même par un conteneur arrêté, moins de deux heures |
| Cache           | buildctl interne Railpack, IDs inventoriés, âge deux heures, plafond 2 048 Mo                         | Références utilisées/récentes, volume d’état conservé ; plafond souple si protections empêchent d’y descendre    |
| Restes de build | Arrêtés, construction de plus de deux heures, image du dépôt ET label `yokkai.cleanup.role=app-build` | Tous les autres conteneurs ; aucun étiquetage automatique de l’existant                                          |
| Dumps           | Sept jours UTC distincts maximum sur quatorze jours, doublons/anciens excédentaires retirés           | Dernière sauvegarde toujours conservée même ancienne ; autres séries et bases actives exclues                    |

Images Supabase/Coolify, images sans étiquette, volumes, réseaux et journal de
suppression de comptes : jamais candidats. Aucune suppression directe dans les
répertoires internes Docker. Aucun changement de configuration Supabase/Traefik.

Seule série SQL admise, sans récursion :

```text
/data/coolify/backups/databases/root-team-0/supabase-yokkai-supabase-db-gawq4yyxiise96wens0dt1ex
```

Seuls noms complets `pg-dump-postgres-<timestamp>.dmp`, date UTC du nom, chemin
canonique, fichiers réguliers sans lien. Dernière et candidates entièrement lues
en flux par `pg_restore --file=/dev/null`, sans connexion à une base ni sortie SQL.
Archive invalide, trop petite, modifiée depuis moins de dix minutes ou inventaire
changé : arrêt. Les autres dumps, archives physiques et `/var/backups` sont exclus.

## Garde-fou ciblé, nouvelles tentatives et journal

Critiques : application courante, PostgreSQL, envoy, proxy public, auth et REST.
Un critique absent, arrêté ou en pause bloque. Les non-critiques arrêtés, tâches
terminées (exited 0 compris) et absence de sonde ne bloquent pas. Une ancienne
application arrêtée ne bloque pas si une courante unique existe ; son image reste
protégée. Une sonde unhealthy seule sur un conteneur running ne déclenche pas
l’ancien blocage global ; HTTP public/interne et pg_isready restent obligatoires.

Queue Coolify non vide, helper actif ou références BuildKit `inUse` : attente.
BuildKit simplement running n’est pas un build actif. Démarrage d’un critique :
attente aussi. Premier essai puis au plus trois retries espacés de 60 secondes,
puis STOP avec noms, états, santé, exit code et références concernés.
La file est lue dans une transaction SQL READ ONLY limitée aux statuts/références
explicitement autorisés, sans clé admin ou service_role. Une file illisible
n’est jamais considérée vide.

Verrou flock commun `/run/yokkai-storage-maintenance.lock`. Verrou occupé : SKIP,
pas de purge concurrente. Simulation par défaut, `--apply` pour supprimer.
Première apply liée à l’empreinte du dry-run relu. Simulation : écrit uniquement
journal et métadonnées de protection, aucune suppression.
État privé root 600 dans `/var/lib/yokkai-storage-maintenance`, dossier 700.
Avant toute suppression, `in_progress=true` est synchronisé sur disque ; succès
et santé finale seuls le lèvent. Exception : `paused=true` aussi. Après interruption,
audit et réparation nécessaires avant nouvelle purge ; ne pas effacer le marqueur
pour contourner un échec ou changer un pin manquant.

Après deux exécutions en STOP, `logger -p daemon.err` écrit l’alerte locale.
Une alerte par série d’échecs ; succès réarme le compteur, envoi local impossible
réessayé au prochain STOP. Compteur durable `runs.json`. Pas de Discord, pas de
lecture de webhook et pas de notification externe, conformément à la décision finale.

Contrôles répétés avant chaque opération. Pas de verrou atomique sur Coolify :
un déploiement peut commencer entre deux contrôles. Docker sans force refuse
une image référencée ; BuildKit protège ses références actives. Ne pas réactiver
le nettoyage natif Coolify en parallèle.

Journal JSON dans journald : candidats, protections, suppressions, df/Docker
avant/après. Plafonds existants conservés : journald 200 Mo / sept jours ; Docker
10 Mo × 3. Aucun redémarrage du démon nécessaire.

## Installation et automatisation

Archive du commit relu et vert sous `/opt/yokkai-ops/revisions/<commit>/`,
pointeur `/opt/yokkai-ops/current`. `upgrade` conserve l’état de rollback et
installe en simulation. Après première apply saine, `activate` met le mode réel.
Il garde le timer d’Abdou : nuit 03:30 Europe/Paris, plus 00:00, 06:00, 12:00,
18:00 UTC ; délai aléatoire maximal d’une minute. Le service événements redémarré
charge la nouvelle version et attend trois minutes après le dernier démarrage
applicatif ; rafales regroupées, même service et même verrou. Après conflit/échec,
le watcher réessaie après une minute. Reconnexion : réconciliation des événements manqués.

```sh
# Depuis la release immuable du commit validé :
sudo bash ops/install-storage-maintenance.sh upgrade
sudo /usr/local/sbin/yokkai-storage-maintenance --dry-run
# Après lecture et vérification de la liste :
sudo /usr/local/sbin/yokkai-storage-maintenance --apply --expect-plan <empreinte-relue>
# Après santé et première apply réussies :
sudo bash ops/install-storage-maintenance.sh activate
```

Avant/après : df, docker system df, tous les conteneurs, PostgreSQL et HTTP 200
sur les trois pages. Aucun compte ni partage créé. Le premier passage réel est
déjà réussi ; une mise à jour sans changement de sélection conserve cette preuve.

```sh
sudo journalctl -t yokkai-storage --since today --no-pager
sudo journalctl -p err -t yokkai-storage --since today --no-pager
sudo journalctl -u yokkai-storage-maintenance-events --since today --no-pager
systemctl list-timers --all yokkai-storage-maintenance.timer
sudo cat /var/lib/yokkai-storage-maintenance/state.json
```

## Désactivation et réparation

Pour geler les suppressions : remettre `CLEANUP_MODE=--dry-run` dans
`/etc/default/yokkai-storage-maintenance` et arrêter seulement le service événements.
Le timer reste conservé ; ses passages deviennent des simulations.

Snapshot de reprise vérifié, root 700 :
`/var/backups/yokkai-ops-config/20261015T003557105985238Z`.
Script, service, timer, service événements, mode, journald et logrotate copiés,
SHA256 contrôlés. `previous-release` indique la version précédente.
Journald/logrotate n’ont pas été modifiés. Pour revenir à cette configuration :

```sh
snapshot=/var/backups/yokkai-ops-config/20261015T003557105985238Z
sudo systemctl stop yokkai-storage-maintenance-events.service
for path in /usr/local/sbin/yokkai-storage-maintenance /etc/default/yokkai-storage-maintenance /etc/systemd/system/yokkai-storage-maintenance.service /etc/systemd/system/yokkai-storage-maintenance.timer /etc/systemd/system/yokkai-storage-maintenance-events.service; do
  sudo cp -a "$snapshot/files$path" "$path"
done
sudo ln -sfn "$(sudo cat "$snapshot/previous-release")" /opt/yokkai-ops/current
sudo systemctl daemon-reload
sudo systemctl restart yokkai-storage-maintenance.timer
```

Le mode sauvegardé est dry-run. Garder les métadonnées de protection courantes ;
ce retour de configuration ne recrée pas les données retirées. Un cache se
reconstitue, une image exige reconstruction ; un dump sans copie est irrécupérable.
Le snapshot initial `20261014T233834311541Z` et le mode `rollback` de l’installateur
rétablissent l’ancien script global : option historique à faire relire, car ses
protections sont plus faibles. Préférer le snapshot de reprise ci-dessus.

## Inventaire observé avant correction

23 conteneurs tous running, aucun paused/exited ; un conteneur supplémentaire
sans sonde a disparu ensuite pendant le build. Au contrôle après nettoyage :
22 running, toutes les sondes présentes healthy.

| Nom au relevé                                    | État                               | Santé      |
| ------------------------------------------------ | ---------------------------------- | ---------- |
| coolify-sentinel                                 | running                            | healthy    |
| 4nxumgfhmmjzcpmgy2hxbkes                         | running, disparu ensuite           | sans sonde |
| lbugcql3gc8ijtbv7qqy70do-001410284090            | running, version remplacée ensuite | sans sonde |
| supabase-envoy-gawq4yyxiise96wens0dt1ex          | running                            | healthy    |
| supabase-edge-functions-gawq4yyxiise96wens0dt1ex | running                            | healthy    |
| supabase-storage-gawq4yyxiise96wens0dt1ex        | running                            | healthy    |
| supabase-studio-gawq4yyxiise96wens0dt1ex         | running                            | healthy    |
| supabase-supavisor-gawq4yyxiise96wens0dt1ex      | running                            | healthy    |
| supabase-meta-gawq4yyxiise96wens0dt1ex           | running                            | healthy    |
| realtime-dev-gawq4yyxiise96wens0dt1ex            | running                            | healthy    |
| supabase-auth-gawq4yyxiise96wens0dt1ex           | running                            | healthy    |
| supabase-rest-gawq4yyxiise96wens0dt1ex           | running                            | sans sonde |
| supabase-analytics-gawq4yyxiise96wens0dt1ex      | running                            | healthy    |
| supabase-db-gawq4yyxiise96wens0dt1ex             | running                            | healthy    |
| supabase-vector-gawq4yyxiise96wens0dt1ex         | running                            | healthy    |
| supabase-rustfs-gawq4yyxiise96wens0dt1ex         | running                            | healthy    |
| imgproxy-gawq4yyxiise96wens0dt1ex                | running                            | healthy    |
| buildx_buildkit_coolify-railpack0                | running                            | sans sonde |
| coolify-proxy                                    | running                            | healthy    |
| coolify                                          | running                            | healthy    |
| coolify-db                                       | running                            | healthy    |
| coolify-redis                                    | running                            | healthy    |
| coolify-realtime                                 | running                            | healthy    |

## Capacité et suivi

Au moins seize builds observés le 14 octobre, pas seize déploiements certifiés.
À 2,04–3,28 Go/image : 32,6–52,5 Go logiques/jour plus variation du cache.
L’estimation de 1,51 Go propres/image donnait environ 24,2 Go/jour avant purge,
plus cache ; ce n’est pas une mesure nette de df. Garder 10–15 Gio de marge.
74 Gio restent une capacité de bêta ; 120–160 Gio recommandés pour une marge durable.
Agrandissement OVH réservé à Walid, hors intervention.
Suivi à 24 h en lecture seule : espace, suppressions, refus, santé, incidents ;
pas de nouvelle action destructive dans ce suivi.
