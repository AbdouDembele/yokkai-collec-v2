#!/usr/bin/env python3
"""One fail-closed cleaner. Dry-run by default; no Docker volume operations."""
import argparse
import contextlib
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import ipaddress
import stat
import subprocess
import sys
import tempfile
import time

APP = "lbugcql3gc8ijtbv7qqy70do"
DB = "supabase-db-gawq4yyxiise96wens0dt1ex"
BUILDER = "buildx_buildkit_coolify-railpack0"
BACKUPS = Path("/data/coolify/backups/databases/root-team-0/supabase-yokkai-supabase-db-gawq4yyxiise96wens0dt1ex")
STATE = Path("/var/lib/yokkai-storage-maintenance/state.json")
LOCK = "/run/yokkai-storage-maintenance.lock"
DAY = 86400
RUNS = STATE.with_name("runs.json")
CRITICAL_NAMES = (DB, "coolify-proxy", *(f"supabase-{role}-{DB.removeprefix('supabase-db-')}"
                   for role in ("envoy", "auth", "rest")))

QUEUE_PHP = r"""<?php
require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$db = Illuminate\Support\Facades\DB::connection();
$db->beginTransaction();
try {
    $db->statement('SET TRANSACTION READ ONLY');
    echo json_encode($db->table('application_deployment_queues')
        ->select('status','commit','application_id')
        ->whereNotIn('status',['finished','failed','cancelled-by-user'])->get());
} finally { $db->rollBack(); }
"""


class Unsafe(RuntimeError):
    pass


class Busy(Unsafe):
    pass


class GuardBlocked(Unsafe):
    def __init__(self, reason, details, retryable=False):
        super().__init__(reason)
        self.details = details
        self.retryable = retryable


def log(event, **data):
    print(json.dumps(dict(time=dt.datetime.now(dt.timezone.utc).isoformat(),
                          event=event, **data), sort_keys=True), flush=True)


def run(args, data=None, timeout=120, stdin=None):
    result = subprocess.run(args, input=data, stdin=stdin, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=timeout)
    if result.returncode:
        # Never print application stderr or environment values: bootstrap may contain secrets.
        raise Unsafe(f"command failed ({result.returncode}): {' '.join(args[:3])}")
    return result.stdout.decode("utf-8", errors="replace")


def created(value):
    if isinstance(value, (int, float)):
        return value
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def app_image(image):
    tags = image.get("RepoTags") or []
    return bool(tags) and all(tag.rsplit(":", 1)[0] == APP for tag in tags)


def image_decisions(images, containers, current, rollback, now):
    by_id = {im["Id"]: im for im in images}
    if any(value not in by_id or not app_image(by_id[value]) for value in (current, rollback)):
        raise Unsafe("current or rollback image is missing or belongs to another repository")
    latest = {im["Id"] for im in sorted(images, key=lambda im: created(im["Created"]), reverse=True)[:3]}
    used = {container["Image"] for container in containers}
    keep, remove = {}, []
    for image in images:
        reasons = []
        if not app_image(image):
            reasons.append("foreign-or-unknown")
        if image["Id"] in latest:
            reasons.append("latest-three")
        if image["Id"] in used:
            reasons.append("container")
        if image["Id"] == current:
            reasons.append("current")
        if image["Id"] == rollback:
            reasons.append("rollback")
        if now - created(image["Created"]) < 7200:
            reasons.append("under-two-hours")
        if reasons:
            keep[image["Id"]] = reasons
        else:
            remove.append(image)
    return keep, remove


def signature(info):
    return [info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns]


def backup_inventory(root, now):
    if root.resolve() != root or not root.is_dir():
        raise Unsafe("backup directory missing or symlinked")
    result = []
    for path in root.iterdir():
        match = re.fullmatch(r"pg-dump-postgres-([0-9]+)\.dmp", path.name)
        if not match:
            continue
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise Unsafe("nonregular or linked backup")
        timestamp = int(match[1])
        if timestamp > now + 300:
            raise Unsafe("backup timestamp is in the future")
        result.append(dict(path=str(path), created=timestamp, size=info.st_size,
                           signature=signature(info)))
    if not result:
        raise Unsafe("no daily backup: no deletion permitted")
    return result


def backup_decisions(records, now):
    keep, remove, days = {}, [], set()
    for record in sorted(records, key=lambda r: r["created"], reverse=True):
        day = dt.datetime.fromtimestamp(record["created"], dt.timezone.utc).date()
        path = record["path"]
        if not keep:
            keep[path] = ["latest-backup"]
            days.add(day)
        elif now - record["created"] <= 14 * DAY and day not in days and len(keep) < 7:
            keep[path] = ["daily-within-seven-and-fourteen-days"]
            days.add(day)
        else:
            remove.append(record)
    return keep, remove


def require_idle_queue(rows):
    if not isinstance(rows, list) or rows:
        raise GuardBlocked("Coolify deployment queue is not empty or cannot be determined",
                           [dict(name="coolify", state="deployment-pending", queue=rows)],
                           retryable=isinstance(rows, list) and bool(rows))


def containers():
    ids = run(["docker", "ps", "-aq", "--no-trunc"]).split()
    if not ids:
        raise Unsafe("Docker returned no containers")
    return json.loads(run(["docker", "inspect", *ids]))


def is_build(container):
    labels = container["Config"].get("Labels") or {}
    return (container["Config"]["Image"].startswith(APP + ":")
            and labels.get("yokkai.cleanup.role") == "app-build")


def container_status(row):
    state = row["State"]
    return dict(name=row["Name"].lstrip("/"), state=state["Status"],
                running=state["Running"], paused=state.get("Paused", False),
                health=state.get("Health", {}).get("Status", "none"), exit_code=state.get("ExitCode"))


def check_containers(rows):
    helpers = [row for row in rows if row["State"]["Running"] and
               re.search(r"(^|/)coollabsio/coolify-helper[:@]", row["Config"]["Image"])]
    if helpers:
        raise GuardBlocked("deployment helper active", [container_status(row) for row in helpers], True)
    apps = [row for row in rows if row["Config"]["Image"].startswith(APP + ":") and not is_build(row)]
    active = [row for row in apps if row["State"]["Running"]]
    if len(active) != 1:
        raise GuardBlocked("cannot identify one running application", [container_status(row) for row in apps]
                           or [dict(name="application", state="missing")],
                           len(active) > 1 or any(row["State"]["Status"] in ("created", "restarting")
                           or row["State"].get("Health", {}).get("Status") == "starting" for row in apps))
    critical = [active[0]]
    for name in CRITICAL_NAMES:
        matches = [row for row in rows if row["Name"].lstrip("/") == name]
        if len(matches) != 1:
            raise GuardBlocked("critical container missing", [dict(name=name, state="missing")])
        critical.extend(matches)
    bad, transient = [], []
    for row in critical:
        state = row["State"]
        status = container_status(row)
        if state.get("Restarting") or state["Status"] in ("created", "restarting") or status["health"] == "starting":
            transient.append(status)
        elif not state["Running"] or state.get("Paused"):
            bad.append(status)
    if bad:
        raise GuardBlocked("critical container not running", bad + transient)
    if transient:
        raise GuardBlocked("critical container starting", transient, True)
    return active[0]["Image"]


def preflight_once(expected_current=None):
    require_idle_queue(json.loads(run(["docker", "exec", "-i", "coolify", "php"], QUEUE_PHP.encode())))
    rows = containers()
    current = check_containers(rows)
    cache = json.loads(run(["docker", "exec", BUILDER, "buildctl", "du", "--format", "{{json .}}"] )) or []
    active_refs = [record["id"] for record in cache if record["inUse"]]
    if active_refs:
        raise GuardBlocked("BuildKit build active", [dict(name=BUILDER, state="building", records=active_refs)], True)
    if expected_current and current != expected_current:
        raise GuardBlocked("application image changed during maintenance",
                           [container_status(row) for row in rows if row["Image"] == current])
    try:
        run(["docker", "exec", DB, "pg_isready", "-U", "postgres", "-d", "postgres"])
    except Unsafe as error:
        raise GuardBlocked("PostgreSQL is not accepting connections",
                           [dict(name=DB, state="not-ready")]) from error
    return rows, current


def preflight(expected_current=None):
    for attempt in range(4):
        try:
            return preflight_once(expected_current)
        except GuardBlocked as error:
            if not error.retryable or attempt == 3:
                raise
            log("RETRY", reason=str(error), containers=error.details, retry=attempt + 1, delay_seconds=60)
            time.sleep(60)


def health(rows=None, current=None):
    bases = ["https://yokkai-collec.com"]
    if rows is not None:
        app = next(row for row in rows if row["Image"] == current
                   and row["Config"]["Image"].startswith(APP + ":")
                   and row["State"]["Running"] and not is_build(row))
        if "3000/tcp" not in (app["Config"].get("ExposedPorts") or {}):
            raise Unsafe("application port changed")
        addresses = [network.get("IPAddress", "")
                     for network in app["NetworkSettings"]["Networks"].values()]
        addresses = [address for address in addresses if address]
        if not addresses:
            raise Unsafe("application internal address unavailable")
        bases.append("http://" + str(ipaddress.IPv4Address(addresses[0])) + ":3000")
    for base in bases:
        check_http(base)


def check_http(base):
    for path in ("/", "/login", "/signup"):
        code = run(["curl", "-fsSL", "--max-time", "20", "-o", "/dev/null",
                    "-w", "%{http_code}", base + path])
        if code != "200":
            raise Unsafe("site health check failed")
        log("http-health", target="public" if base.startswith("https") else "application", path=path, status=code)


def images():
    ids = list(dict.fromkeys(run(["docker", "image", "ls", "-q", "--no-trunc", APP]).split()))
    if not ids:
        raise Unsafe("no application images")
    return json.loads(run(["docker", "image", "inspect", *ids]))


def save_state(state, path=None):
    path = STATE if path is None else path
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".state-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(state, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(name, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def load_state():
    if STATE.is_symlink() or not STATE.is_file() or STATE.stat().st_uid != 0:
        raise Unsafe("trusted rollback state is absent")
    result = json.loads(STATE.read_text())
    for field in ("current", "rollback"):
        if not re.fullmatch(r"sha256:[a-f0-9]{64}", result.get(field, "")):
            raise Unsafe("invalid rollback state")
    return result


def cache_inventory():
    text = run(["docker", "exec", BUILDER, "buildctl", "du", "--format", "{{json .}}"])
    records = []
    for record in json.loads(text) or []:
        if record.get("inUse") is False:
            identifier = record.get("id", "")
            if not re.fullmatch(r"[a-z0-9]{20,}", identifier):
                raise Unsafe("unknown BuildKit record identifier")
            records.append(dict(id=identifier, bytes=record["size"],
                                created=record["createdAt"], last_used=record.get("lastUsedAt")))
    return sorted(records, key=lambda r: r["id"])


def cache_command(records):
    if not records:
        return None
    command = ["docker", "exec", BUILDER, "buildctl", "prune",
               "--keep-duration", "2h", "--keep-storage", "2048", "--all"]
    for record in records:
        command.extend(["--filter", "id==" + record["id"]])
    return command


def require_same_backups(expected):
    actual = backup_inventory(BACKUPS, time.time())
    key = lambda record: record["path"]
    if sorted(actual, key=key) != sorted(expected, key=key):
        raise Unsafe("backup inventory changed; a new dry-run is required")


def validate_backup(record):
    path = Path(record["path"])
    if record["size"] < 1000 or time.time() - path.stat().st_mtime < 600:
        raise Unsafe("backup too small or still being written")
    # Render the COMPLETE archive without connecting to any database.
    with path.open("rb") as archive:
        run(["docker", "exec", "-i", DB, "pg_restore", "--file=/dev/null"],
            stdin=archive, timeout=300)
    if signature(path.lstat()) != record["signature"]:
        raise Unsafe("backup changed while validating")


def observe(state, current):
    if state["current"] != current:
        state = dict(state, rollback=state["current"], current=current)
        save_state(state)
        log("rollback-observed", current=current, rollback=state["rollback"])
    return state


def require_activation(state, expected_hash):
    if state.get("paused") or state.get("in_progress"):
        raise Unsafe("cleanup paused after an interrupted apply; operator review required")
    if not state.get("activated") and not expected_hash:
        raise Unsafe("first apply requires the reviewed dry-run hash")


def metrics(label):
    log("disk", label=label, output=run(["df", "-h", "/"]).strip())
    log("docker-space", label=label, output=run(["docker", "system", "df"]).strip())


@contextlib.contextmanager
def locked():
    import fcntl
    with open(LOCK, "a") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise Busy("another cleanup holds the common lock") from error
        yield


def make_plan():
    rows, current = preflight()
    health(rows, current)
    state = observe(load_state(), current)
    rollback = state["rollback"]
    all_images = images()
    kept_images, removed_images = image_decisions(all_images, rows, current, rollback, time.time())
    records = backup_inventory(BACKUPS, time.time())
    kept_backups, removed_backups = backup_decisions(records, time.time())
    latest = max(records, key=lambda record: record["created"])
    for record in [latest, *removed_backups]:
        validate_backup(record)
    require_same_backups(records)
    stopped = [dict(id=row["Id"], name=row["Name"], created=row["Created"])
               for row in rows if is_build(row) and not row["State"]["Running"]
               and time.time() - created(row["Created"]) >= 7200]
    plan = dict(current=current, rollback=rollback, images=removed_images,
                backups=removed_backups, backup_inventory=records, containers=stopped, cache=cache_inventory())
    digestable = dict(current=current, rollback=rollback,
                      images=sorted(image["Id"] for image in removed_images),
                      backups=records, containers=stopped, cache=plan["cache"])
    plan["hash"] = hashlib.sha256(json.dumps(digestable, sort_keys=True).encode()).hexdigest()
    for image in all_images:
        log("image-protected" if image["Id"] in kept_images else "image-candidate",
            id=image["Id"], tags=image.get("RepoTags"), created=image["Created"],
            bytes=image["Size"], reasons=kept_images.get(image["Id"], []))
    for record in records:
        log("backup-protected" if record["path"] in kept_backups else "backup-candidate",
            **record, reasons=kept_backups.get(record["path"], []))
    for record in stopped:
        log("build-container-candidate", **record)
    log("cache-candidates-upper-bound", records=plan["cache"], keep_duration="2h", keep_storage_mb=2048)
    log("plan", hash=plan["hash"], images=len(removed_images), backups=len(removed_backups),
        stopped_builds=len(stopped), volume_candidates=0,
        backup_candidate_bytes=sum(record["size"] for record in removed_backups))
    return plan


def apply_plan(plan):
    current = plan["current"]
    preflight(current)
    require_same_backups(plan["backup_inventory"])
    if cache_inventory() != plan["cache"]:
        raise Unsafe("build cache changed; a new dry-run is required")
    for image in plan["images"]:
        rows, _ = preflight(current)
        if image["Id"] in {row["Image"] for row in rows}:
            raise Unsafe("candidate image became used")
        fresh = json.loads(run(["docker", "image", "inspect", image["Id"]]))[0]
        if not app_image(fresh) or fresh["RepoTags"] != image["RepoTags"]:
            raise Unsafe("image tags changed")
        run(["docker", "image", "rm", image["Id"]])
        log("image-deleted", id=image["Id"], tags=image["RepoTags"],
            created=image["Created"], logical_bytes=image["Size"])
    preflight(current)
    if cache_inventory() != plan["cache"]:
        raise Unsafe("build cache changed before pruning")
    command = cache_command(plan["cache"])
    if command:
        output = run(command, timeout=300)
        log("cache-pruned", keep_duration="2h", keep_storage_mb=2048, output=output.strip())
    for container in plan["containers"]:
        preflight(current)
        fresh = json.loads(run(["docker", "inspect", container["id"]]))[0]
        if fresh["State"]["Running"] or not is_build(fresh):
            raise Unsafe("build container changed")
        run(["docker", "container", "rm", container["id"]])
        log("build-container-deleted", **container)
    expected_backups = list(plan["backup_inventory"])
    for record in plan["backups"]:
        preflight(current)
        require_same_backups(expected_backups)
        directory = os.open(BACKUPS, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            info = os.stat(Path(record["path"]).name, dir_fd=directory, follow_symlinks=False)
            if signature(info) != record["signature"] or not stat.S_ISREG(info.st_mode):
                raise Unsafe("backup inode changed")
            os.unlink(Path(record["path"]).name, dir_fd=directory)
        finally:
            os.close(directory)
        expected_backups.remove(record)
        log("backup-deleted", path=record["path"], created=record["created"], bytes=record["size"])
    rows, _ = preflight(current)
    health(rows, current)
    save_state(dict(load_state(), activated=True, in_progress=False, last_completed_at=time.time()))


def watch():
    # This daemon never holds the cleanup lock while waiting for events.
    process = subprocess.Popen(["docker", "events", "--filter", "type=container",
                                "--filter", "event=start", "--format", "{{json .}}"],
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0)
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    deadline = time.monotonic() + 180  # Reconcile missed events after a restart.
    pending = b""
    try:
        while process.poll() is None:
            timeout = max(0, deadline - time.monotonic()) if deadline is not None else None
            for key, _ in selector.select(timeout):
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk:
                    raise Unsafe("Docker event stream ended")
                pending += chunk
                while b"\n" in pending:
                    line, pending = pending.split(b"\n", 1)
                    event = json.loads(line)
                    image = event.get("Actor", {}).get("Attributes", {}).get("image", "")
                    if image.startswith(APP + ":"):
                        deadline = time.monotonic() + 180
            if deadline is not None and time.monotonic() >= deadline:
                attempt = time.time()
                try:
                    run(["systemctl", "start", "yokkai-storage-maintenance.service"], timeout=1500)
                    state = load_state()
                    _, current = preflight()
                    complete = (state.get("last_completed_at", 0) >= attempt
                                and state["current"] == current)
                except Unsafe:
                    complete = False
                deadline = None if complete else time.monotonic() + 60
                log("deployment-cleanup-requested", completed=complete)
        raise Unsafe("Docker event stream disconnected")
    finally:
        selector.close()
        process.terminate()
        process.wait(timeout=10)


def journal_alert(message):
    run(["logger", "-p", "daemon.err", "-t", "yokkai-storage", message])


def record_result(error=None):
    state = json.loads(RUNS.read_text()) if RUNS.exists() else {}
    if error is None:
        save_state(dict(consecutive_stops=0, alert_sent=False), path=RUNS)
        return
    details = getattr(error, "details", [])
    count = state.get("consecutive_stops", 0) + 1
    names = sorted(set(state.get("names", [])) | {item["name"] for item in details})
    state.update(consecutive_stops=count, names=names, reason=str(error), alert_sent=state.get("alert_sent", False))
    save_state(state, path=RUNS)
    if count >= 2 and not state["alert_sent"]:
        try:
            journal_alert("Yokkai storage maintenance: " + str(count) + " consecutive STOPs. Containers: "
                          + (", ".join(names) or "none identified") + ". Reason: " + str(error))
            state["alert_sent"] = True
            save_state(state, path=RUNS)
            log("repeated-stop-alert", channel="journal", consecutive_stops=count, containers=names)
        except Exception:
            log("journal-alert-failed", consecutive_stops=count, containers=names,
                reason="journal delivery failed; next STOP will retry")


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--watch", action="store_true")
    mode.add_argument("--initialize-state", action="store_true")
    parser.add_argument("--rollback-image")
    parser.add_argument("--expect-plan")
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise Unsafe("run as root through the authorized installation")
    if args.watch:
        return watch()
    with locked():
        if args.initialize_state:
            if STATE.exists():
                raise Unsafe("state already exists; do not overwrite rollback history")
            rows, current = preflight()
            health(rows, current)
            image_decisions(images(), rows, current, args.rollback_image, time.time())
            save_state(dict(current=current, rollback=args.rollback_image, activated=False))
            log("rollback-state-initialized", current=current, rollback=args.rollback_image)
            return
        metrics("before")
        plan = make_plan()
        if args.expect_plan and args.expect_plan != plan["hash"]:
            raise Unsafe("dry-run plan changed: no deletion")
        if args.apply:
            require_activation(load_state(), args.expect_plan)
            save_state(dict(load_state(), in_progress=True))
            try:
                apply_plan(plan)
            except Exception:
                save_state(dict(load_state(), paused=True))
                raise
        metrics("after")
        record_result()
        log("completed", mode="apply" if args.apply else "dry-run", plan=plan["hash"])


if __name__ == "__main__":
    try:
        main()
    except Busy as error:
        log("SKIP", reason=str(error), containers=[])
    except Exception as error:
        log("STOP", reason=str(error) if isinstance(error, Unsafe) else type(error).__name__,
            containers=getattr(error, "details", []))
        if "--watch" not in sys.argv:
            try:
                with locked():
                    record_result(error if isinstance(error, Unsafe) else Unsafe(type(error).__name__))
            except Exception:
                log("stop-counter-error", reason="could not persist STOP counter or acquire lock")
        sys.exit(1)
