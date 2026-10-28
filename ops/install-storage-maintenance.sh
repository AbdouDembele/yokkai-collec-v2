#!/bin/bash
# Install only an immutable, reviewed Git archive. No cleanup runs in this installer.
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
[[ $(id -u) == 0 ]] || { echo "Run as root using authorized sudo" >&2; exit 1; }
mode=${1:-}
release=$(cd -- "$(dirname -- "$0")/.." && pwd -P)
[[ "$release" =~ ^/opt/yokkai-ops/revisions/[a-f0-9]{40}$ ]] || exit 1
snapshot=/var/backups/yokkai-ops-config/20261014T233834311541Z
[[ -f "$snapshot/manifest.json" ]] || exit 1
service=yokkai-storage-maintenance

if [[ "$mode" == prepare ]]; then
  [[ $# == 2 ]] || { echo "prepare requires the observed rollback image ID" >&2; exit 1; }
  [[ ! -e /var/lib/yokkai-storage-maintenance/state.json ]] || exit 1
  python3 "$release/ops/storage_maintenance.py" --initialize-state --rollback-image "$2"
fi
exec 9>/run/yokkai-storage-maintenance.lock
flock -n 9 || { echo "Maintenance lock busy" >&2; exit 1; }
if systemctl is-active --quiet "$service.service"; then
  echo "Maintenance already running; stop installation" >&2
  exit 1
fi
case "$mode" in
  prepare|upgrade)
    [[ -f /var/lib/yokkai-storage-maintenance/state.json ]] || exit 1
    install -d -m 700 /var/lib/yokkai-storage-maintenance
    install -d -m 755 /opt/yokkai-ops /etc/default
    printf '%s\n' 'CLEANUP_MODE=--dry-run' > /etc/default/$service
    chmod 600 /etc/default/$service
    ln -sfn "$release" /opt/yokkai-ops/current
    install -m 755 "$release/ops/$service" /usr/local/sbin/$service
    for unit in "$service.service" "$service-events.service"; do
      install -m 644 "$release/ops/$unit" /etc/systemd/system/
    done
    systemctl daemon-reload
    # Existing night timer remains enabled. New events service is not started yet.
    echo "Installed in dry-run mode; timer activation awaits successful manual apply"
    ;;
  activate)
    python3 - <<'PY'
import json
state = json.load(open('/var/lib/yokkai-storage-maintenance/state.json'))
assert state.get('activated') and not state.get('paused') and not state.get('in_progress'), 'Successful manual apply required'
PY
    printf '%s\n' 'CLEANUP_MODE=--apply' > /etc/default/$service
    chmod 600 /etc/default/$service
    install -m 644 "$release/ops/$service.timer" /etc/systemd/system/
    systemctl daemon-reload
    systemctl enable "$service.timer" "$service-events.service"
    systemctl restart "$service.timer"
    systemctl restart "$service-events.service"
    echo "Existing timer extended; deployment events enabled"
    ;;
  rollback)
    systemctl disable --now "$service-events.service" || true
    for path in /usr/local/sbin/$service /etc/systemd/system/$service.service /etc/systemd/system/$service.timer; do
      cp -a "$snapshot/files$path" "$path"
    done
    # Legacy service ignores the inert dry-run environment file and versioned release.
    systemctl daemon-reload
    systemctl enable "$service.timer"
    systemctl restart "$service.timer"
    echo "Original script and night timer restored; data deletions are not reversible"
    ;;
  *) echo "Use prepare ROLLBACK_IMAGE, upgrade, activate, or rollback" >&2; exit 1 ;;
esac
