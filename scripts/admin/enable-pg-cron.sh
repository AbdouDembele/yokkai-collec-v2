#!/usr/bin/env bash
# One-time administrative prerequisite, NOT a migration. No secrets are passed.
# Default is dry-run; --apply requires an interactive confirmation. Never run in CI.
set -euo pipefail
mode="${1:---dry-run}"
[[ $# -le 1 && ( "$mode" == --dry-run || "$mode" == --apply ) ]] || { echo 'Usage: enable-pg-cron.sh [--dry-run|--apply]' >&2; exit 2; }
: "${PROD_SSH_ALIAS:?Set an alias from ~/.ssh/config}"
PROD_DB_CONTAINER="${PROD_DB_CONTAINER:-supabase-db}"
PROD_BACKUP_DIR="${PROD_BACKUP_DIR:-/var/backups/yokkai-pg-cron}"
[[ "$PROD_SSH_ALIAS" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$ ]] || { echo 'Invalid SSH alias' >&2; exit 2; }
[[ "$PROD_DB_CONTAINER" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || { echo 'Invalid container name' >&2; exit 2; }
[[ "$PROD_BACKUP_DIR" =~ ^/[a-zA-Z0-9_/-]+$ && "$PROD_BACKUP_DIR" != / ]] || { echo 'Invalid backup directory' >&2; exit 2; }
echo "Would validate a full VPS backup in $PROD_BACKUP_DIR, then enable pg_cron as supabase_admin and grant scheduling access to postgres."
[[ "$mode" == --apply ]] || { echo 'Dry-run: no production commands or writes.'; exit 0; }
[[ -t 0 ]] || { echo '--apply requires an interactive terminal' >&2; exit 1; }
printf 'One-time pg_cron activation. Type ENABLE-PG-CRON: ' > /dev/tty
read -r confirmation < /dev/tty
[[ "$confirmation" == ENABLE-PG-CRON ]] || { echo 'Cancelled'; exit 1; }
ssh -T -p 1022 -o BatchMode=yes "$PROD_SSH_ALIAS" \
  "sudo -n bash -s -- '$PROD_DB_CONTAINER' '$PROD_BACKUP_DIR'" <<'REMOTE'
set -euo pipefail
umask 077
container="$1"; directory="$2"
[[ ! -L "$directory" ]] || { echo 'Backup directory must not be a symlink' >&2; exit 1; }
mkdir -p -- "$directory"
[[ "$(stat -c %u "$directory")" == 0 && "$(stat -c %a "$directory")" == 700 ]] || { echo 'Backup directory must be root-owned with mode 700' >&2; exit 1; }
archive="$directory/enable-pg-cron-$(date -u +%Y%m%dT%H%M%S)-$$.dump"
partial="$(mktemp "$directory/.pg-cron-XXXXXXXX.partial")"
trap 'rm -f -- "$partial"' EXIT
docker exec "$container" pg_dump -w -U postgres -d postgres -Fc > "$partial"
bytes="$(stat -c %s "$partial")"
[[ "$bytes" -gt 1000 ]] || { echo 'Backup empty or suspicious; refusing activation' >&2; exit 1; }
docker exec -i "$container" pg_restore --list < "$partial" > /dev/null
ln -- "$partial" "$archive"
echo "Validated backup: $archive ($bytes bytes); pg_restore --list OK."
docker exec -i "$container" psql -X -w -U supabase_admin -d postgres -v ON_ERROR_STOP=1 <<'SQL'
begin;
create extension if not exists pg_cron;
grant usage on schema cron to postgres;
grant select on table cron.job to postgres;
grant execute on function cron.schedule(text,text,text) to postgres;
set local role postgres;
do $$
begin
  if not has_schema_privilege(current_user,'cron','USAGE')
    or not has_table_privilege(current_user,'cron.job','SELECT')
    or not has_function_privilege(current_user,'cron.schedule(text,text,text)','EXECUTE') then
    raise exception 'postgres lacks pg_cron scheduling/catalogue access';
  end if;
end;
$$;
commit;
SQL
echo 'pg_cron enabled; postgres permissions verified. No auction job scheduled yet.'
REMOTE
