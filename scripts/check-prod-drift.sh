#!/usr/bin/env bash
# READ ONLY on production: SSH key via ~/.ssh/config alias, port 1022;
# docker exec runs psql with SELECT statements only. No production writes,
# migrations, credentials or IP addresses. Replay writes only to disposable
# local PGlite memory. Do not run this automatically in CI.
# Usage: PROD_SSH_ALIAS=my-config-alias bash scripts/check-prod-drift.sh
# Optional: PROD_DB_CONTAINER for a Supabase deployment with a suffixed name.
# Optional: DRIFT_MIGRATIONS_JSON (array of filenames) for the applied prefix;
# deploy-migrations.sh validates this prefix against the production registry.
# Requires node/npm dependencies locally and key-based SSH access; the database
# container must permit local psql authentication (no password passed by script).
# The SSH account must permit passwordless sudo for docker; -n refuses prompts.
# Compares public functions/grants/RLS/triggers, storage policies and signup
# triggers, including exact owners of all public functions (SECURITY DEFINER too).
# Also compares public columns/constraints/indexes/views/enums/sequence settings.
# Compares cron job names, schedules, commands, execution roles and activation.
# Platform-managed auth/storage definitions are excluded; no owner-role mapping.
# Exit codes: 0 aligned, 1 divergence, 2 check impossible, 3 SSH interrupted.
set -euo pipefail
: "${PROD_SSH_ALIAS:?Set an alias from ~/.ssh/config}"
[[ "$PROD_SSH_ALIAS" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$ ]] || { echo 'Invalid SSH alias' >&2; exit 2; }
PROD_DB_CONTAINER="${PROD_DB_CONTAINER:-supabase-db}"
[[ "$PROD_DB_CONTAINER" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || { echo 'Invalid container name' >&2; exit 2; }
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
catalog="$(mktemp)"
trap 'rm -f "$catalog"' EXIT
# Read-only session even if the catalogue SQL is accidentally changed later.
if ssh -T -p 1022 -o BatchMode=yes "$PROD_SSH_ALIAS" \
  "sudo -n docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on -c search_path=public,pg_catalog' $PROD_DB_CONTAINER psql -X -w -U postgres -d postgres -At -v ON_ERROR_STOP=1" \
  < "$root/scripts/schema-catalog.sql" > "$catalog"; then
  :
else
  status=$?
  if [[ "$status" == 255 ]]; then
    echo 'Drift check impossible: SSH connection interrupted or unavailable.' >&2
    exit 3
  fi
  echo 'Drift check impossible: production catalogue extraction failed.' >&2
  exit 2
fi
if node "$root/scripts/compare-schema-catalog.mjs" "$catalog"; then
  exit 0
else
  status=$?
  if [[ "$status" == 1 ]]; then
    echo 'Production divergence detected.' >&2
    exit 1
  fi
  echo 'Drift check impossible: catalogue comparison failed.' >&2
  exit 2
fi
