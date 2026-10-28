#!/usr/bin/env bash
# Default is read-only on the VPS. --apply additionally requires a terminal
# confirmation. All database commands use postgres via key-based SSH.
set -euo pipefail
mode="${1:---dry-run}"
[[ $# -le 1 && ( "$mode" == --dry-run || "$mode" == --apply ) ]] || { echo 'Usage: deploy-migrations.sh [--dry-run|--apply]' >&2; exit 2; }
: "${PROD_SSH_ALIAS:?Set an alias from ~/.ssh/config}"
PROD_DB_CONTAINER="${PROD_DB_CONTAINER:-supabase-db}"
PROD_BACKUP_DIR="${PROD_BACKUP_DIR:-/var/backups/yokkai-migrations}"
[[ "$PROD_SSH_ALIAS" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$ ]] || { echo 'Invalid SSH alias' >&2; exit 2; }
[[ "$PROD_DB_CONTAINER" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || { echo 'Invalid container name' >&2; exit 2; }
[[ "$PROD_BACKUP_DIR" =~ ^/[a-zA-Z0-9_/-]+$ && "$PROD_BACKUP_DIR" != / ]] || { echo 'Invalid absolute backup directory' >&2; exit 2; }
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
# A real deployment replays from a cold initdb unless explicitly told otherwise.
[[ "$mode" != --apply ]] || export YOKKAI_PGLITE_CACHE="${YOKKAI_PGLITE_CACHE:-off}"
if registry="$(ssh -T -p 1022 -o BatchMode=yes "$PROD_SSH_ALIAS" \
  "sudo -n docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' $PROD_DB_CONTAINER psql -X -w -U postgres -d postgres -At -v ON_ERROR_STOP=1" <<'SQL'
select case when current_user='postgres' and has_table_privilege(current_user,'supabase_migrations.schema_migrations','INSERT')
  then coalesce(json_agg(json_build_object('version',version,'name',name) order by version),'[]'::json)
  else json_build_object('error','postgres must have INSERT on the migration registry') end
from supabase_migrations.schema_migrations;
SQL
)"; then
  :
else
  status=$?
  if [[ "$status" == 255 ]]; then
    echo 'Deployment check impossible: SSH connection interrupted or unavailable while reading registry.' >&2
    exit 3
  fi
  echo 'Deployment check impossible: migration registry extraction failed.' >&2
  exit 2
fi
# Missing registry, duplicate versions, gaps and nontransactional SQL fail closed.
plan="$(printf '%s' "$registry" | node scripts/plan-deploy-migrations.mjs)"
applied="$(printf '%s' "$plan" | node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync(0,"utf8")).applied))')"
pending="$(printf '%s' "$plan" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).pending.join("\n"))')"
echo 'Pending migrations:'
printf '%s\n' "${pending:-(none)}"
echo 'Checking production against migrations already applied...'
DRIFT_MIGRATIONS_JSON="$applied" bash scripts/check-prod-drift.sh || { status=$?; echo 'Deployment refused: see drift check reason above; nothing applied.' >&2; exit "$status"; }
[[ -n "$pending" ]] || { echo 'Nothing to apply.'; exit 0; }
echo "Would back up on VPS in $PROD_BACKUP_DIR, validate the archive, keep the last 10 backups,"
echo 'then apply the listed migrations + registry entries in ONE transaction as postgres and check drift again.'
[[ "$mode" == --apply ]] || { echo 'Dry-run: no production writes or backups. Use --apply for interactive confirmation.'; exit 0; }
[[ -t 0 ]] || { echo 'Deployment refused: --apply requires an interactive terminal.' >&2; exit 1; }
printf 'Confirm these migrations:\n%s\nType APPLY: ' "$pending" > /dev/tty
read -r confirmation < /dev/tty
[[ "$confirmation" == APPLY ]] || { echo 'Cancelled; no production writes.'; exit 1; }

# Archive stays on the VPS host, outside the disposable container. Only archives
# with this script's exact filename pattern are eligible for retention pruning.
ssh -T -p 1022 -o BatchMode=yes "$PROD_SSH_ALIAS" \
  "sudo -n bash -s -- '$PROD_DB_CONTAINER' '$PROD_BACKUP_DIR'" <<'BACKUP'
set -euo pipefail
umask 077
container="$1"; directory="$2"
[[ ! -L "$directory" ]] || { echo 'Backup directory must not be a symlink' >&2; exit 1; }
mkdir -p -- "$directory"
[[ "$(stat -c %u "$directory")" == 0 && "$(stat -c %a "$directory")" == 700 ]] || { echo 'Backup directory must be root-owned with mode 700' >&2; exit 1; }
archive="$directory/yokkai-migrations-$(date -u +%Y%m%dT%H%M%S)-$$.dump"
partial="$(mktemp "$directory/.yokkai-migrations-XXXXXXXX.partial")"
trap 'rm -f -- "$partial"' EXIT
docker exec "$container" pg_dump -w -U postgres -d postgres -Fc > "$partial"
bytes="$(stat -c %s "$partial")"
[[ "$bytes" -gt 1000 ]] || { echo 'Backup empty or suspicious; refusing deployment' >&2; exit 1; }
docker exec -i "$container" pg_restore --list < "$partial" > /dev/null
ln -- "$partial" "$archive" # Publish without ever overwriting an existing archive.
echo "Validated backup on VPS: $archive ($bytes bytes); pg_restore --list OK."
archive_list="$(find "$directory" -maxdepth 1 -type f -printf '%T@ %f\n' | grep -E '^[0-9.]+ yokkai-migrations-[0-9]{8}T[0-9]{6}-[0-9]+\.dump$' | LC_ALL=C sort -nr | cut -d ' ' -f 2)"
mapfile -t archives <<< "$archive_list"
for ((i=10; i<${#archives[@]}; i++)); do rm -f -- "$directory/${archives[i]}"; done
BACKUP
# Recheck immediately after backup; changes during backup must not be deployed over.
DRIFT_MIGRATIONS_JSON="$applied" bash scripts/check-prod-drift.sh || { status=$?; echo 'Deployment refused after backup: see drift check reason above; nothing applied.' >&2; exit "$status"; }
printf '%s' "$plan" | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).sql)' | \
  ssh -T -p 1022 -o BatchMode=yes "$PROD_SSH_ALIAS" \
    "sudo -n docker exec -i $PROD_DB_CONTAINER psql -X -w -U postgres -d postgres -v ON_ERROR_STOP=1"
unset DRIFT_MIGRATIONS_JSON # A caller's old prefix must never weaken the final check.
bash scripts/check-prod-drift.sh || { status=$?; echo 'Post-deployment check unsuccessful: see reason above. Transaction committed; investigate, do not automatically roll back.' >&2; exit "$status"; }
echo 'Deployment complete; no drift.'
