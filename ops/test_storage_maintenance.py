import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("cleanup", Path(__file__).with_name("storage_maintenance.py"))
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)

NOW = 2_000_000_000
DAY = 86400


class SafetyContract(unittest.TestCase):
    def test_backups_cap_days_duplicates_and_latest_exception(self):
        records = [dict(path=f"/allowed/{n}", created=NOW - n * DAY, size=1000) for n in range(16)]
        records.append(dict(path="/allowed/duplicate", created=NOW - DAY - 10, size=1000))
        keep, remove = cleanup.backup_decisions(records, NOW)
        self.assertEqual(len(keep), 7)
        self.assertEqual({r["path"] for r in remove}, {f"/allowed/{n}" for n in range(7, 16)} | {"/allowed/duplicate"})
        old = [dict(path=f"/allowed/old{n}", created=NOW - (30 + n) * DAY, size=1000) for n in range(3)]
        keep, remove = cleanup.backup_decisions(old, NOW)
        self.assertEqual(set(keep), {"/allowed/old0"})
        self.assertEqual(len(remove), 2)

    def test_images_keep_three_used_stopped_rollback_and_young(self):
        images = [dict(Id=f"sha256:{n:064x}", Created=NOW - n * 10800,
                       RepoTags=[f"{cleanup.APP}:v{n}"], Size=1000) for n in range(8)]
        containers = [dict(Image=images[4]["Id"]), dict(Image=images[5]["Id"])]
        keep, remove = cleanup.image_decisions(images, containers, images[4]["Id"], images[6]["Id"], NOW)
        self.assertEqual({im["Id"] for im in remove}, {images[3]["Id"], images[7]["Id"]})
        self.assertIn("container", keep[images[5]["Id"]])
        images[7]["Created"] = NOW - 60
        _, remove = cleanup.image_decisions(images, containers, images[4]["Id"], images[6]["Id"], NOW)
        self.assertNotIn(images[7], remove)

    def test_foreign_images_and_unknown_rollback_fail_closed(self):
        image = dict(Id="sha256:" + "a" * 64, Created=NOW - DAY, RepoTags=["supabase/postgres:test"], Size=1000)
        with self.assertRaises(cleanup.Unsafe):
            cleanup.image_decisions([image], [], image["Id"], image["Id"], NOW)

    def test_backup_path_never_accepts_journal_or_partial_or_symlink(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "account_deletion_log.csv").write_text("protected")
            (root / "pg-dump-postgres-1.dmp.partial").write_text("partial")
            (root / "pg-dump-postgres-1.dmp").write_bytes(b"x" * 2000)
            records = cleanup.backup_inventory(root, NOW)
            self.assertEqual([Path(r["path"]).name for r in records], ["pg-dump-postgres-1.dmp"])
            (root / "pg-dump-postgres-3000000000.dmp").write_bytes(b"x" * 2000)
            with self.assertRaises(cleanup.Unsafe):
                cleanup.backup_inventory(root, NOW)

    def test_queue_unavailable_or_pending_never_means_idle(self):
        for rows in [[{"status": "queued"}], [{"status": "in_progress"}], [{"status": "unknown"}]]:
            with self.assertRaises(cleanup.Unsafe):
                cleanup.require_idle_queue(rows)
        cleanup.require_idle_queue([])

    def test_first_apply_requires_reviewed_hash(self):
        with self.assertRaises(cleanup.Unsafe):
            cleanup.require_activation({"activated": False}, None)
        cleanup.require_activation({"activated": False}, "reviewed")
        cleanup.require_activation({"activated": True}, None)
        for state in [{"activated": True, "paused": True}, {"activated": True, "in_progress": True}]:
            with self.assertRaises(cleanup.Unsafe):
                cleanup.require_activation(state, None)

    def test_observed_rollback_persists_before_purge_can_fail(self):
        state = dict(current="A", rollback="previous", activated=True)
        with patch.object(cleanup, "save_state") as save:
            observed = cleanup.observe(state, "B")
            self.assertEqual(observed["rollback"], "A")
            save.assert_called_once_with(observed)
            observed = cleanup.observe(observed, "C")
            self.assertEqual(observed["rollback"], "B")

    def test_new_backup_or_changed_inode_stops_purge(self):
        records = [dict(path="latest", signature=[1, 2, 3000, 4])]
        for actual in [records + [dict(path="new")],
                       [dict(path="latest", signature=[1, 99, 3000, 4])]]:
            with patch.object(cleanup, "backup_inventory", return_value=actual):
                with self.assertRaises(cleanup.Unsafe):
                    cleanup.require_same_backups(records)

    def test_cache_is_limited_to_reviewed_ids_with_age_and_size(self):
        self.assertIsNone(cleanup.cache_command([]))
        command = cleanup.cache_command([dict(id="a" * 25), dict(id="b" * 25)])
        self.assertEqual(command.count("--filter"), 2)
        self.assertIn("id==" + "a" * 25, command)
        self.assertIn("id==" + "b" * 25, command)
        self.assertEqual(command[command.index("--keep-duration") + 1], "2h")
        self.assertEqual(command[command.index("--keep-storage") + 1], "2048")

    def test_complete_archive_is_rendered_without_database_connection(self):
        import tempfile
        import os
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pg-dump-postgres-1.dmp"
            path.write_bytes(b"x" * 2000)
            os.utime(path, (1, 1))
            record = dict(path=str(path), size=2000, signature=cleanup.signature(path.stat()))
            with patch.object(cleanup, "run") as run:
                cleanup.validate_backup(record)
                self.assertEqual(run.call_args.args[0][-2:], ["pg_restore", "--file=/dev/null"])
                self.assertNotIn("--dbname", run.call_args.args[0])

    def test_targeted_container_guard_ignores_noncritical_and_no_probe(self):
        rows = self.critical_rows()
        rows += [self.row("sentinel", health="starting"),
                 self.row("init", running=False, status="exited", exit_code=0),
                 self.row("old-task", running=False, status="exited", exit_code=1)]
        self.assertEqual(cleanup.check_containers(rows), "current")

    @staticmethod
    def row(name, running=True, status="running", health=None, exit_code=0, image="utility:test"):
        state = dict(Running=running, Status=status, Paused=False, Restarting=False, ExitCode=exit_code)
        if health:
            state["Health"] = dict(Status=health)
        return dict(Name="/" + name, Image="current" if image.startswith(cleanup.APP) else "other",
                    State=state, Config=dict(Image=image, Labels={}))

    def critical_rows(self):
        return [self.row(name) for name in cleanup.CRITICAL_NAMES] + [
            self.row("application", image=cleanup.APP + ":current")]

    def test_critical_stopped_is_named_and_fatal_even_exit_zero(self):
        rows = self.critical_rows()
        rows[0]["State"].update(Running=False, Status="exited", ExitCode=0)
        with self.assertRaises(cleanup.GuardBlocked) as caught:
            cleanup.check_containers(rows)
        self.assertFalse(caught.exception.retryable)
        self.assertEqual(caught.exception.details[0]["name"], rows[0]["Name"].lstrip("/"))
        self.assertEqual(caught.exception.details[0]["state"], "exited")

    def test_critical_starting_and_build_are_retryable(self):
        for change in ("starting", "helper"):
            rows = self.critical_rows()
            if change == "starting":
                rows[0]["State"]["Health"] = dict(Status="starting")
            else:
                rows.append(self.row("helper", image="ghcr.io/coollabsio/coolify-helper:1"))
            with self.assertRaises(cleanup.GuardBlocked) as caught:
                cleanup.check_containers(rows)
            self.assertTrue(caught.exception.retryable)

    def test_application_created_retries_and_running_unhealthy_probe_is_not_a_global_stop(self):
        rows = self.critical_rows()
        rows[-1]["State"].update(Running=False, Status="created")
        with self.assertRaises(cleanup.GuardBlocked) as caught:
            cleanup.check_containers(rows)
        self.assertTrue(caught.exception.retryable)
        rows[-1]["State"].update(Running=True, Status="running", Health=dict(Status="unhealthy"))
        self.assertEqual(cleanup.check_containers(rows), "current")

    def test_transient_guard_retries_three_times_at_sixty_seconds(self):
        error = cleanup.GuardBlocked("build", [dict(name="builder", state="busy")], True)
        with patch.object(cleanup, "preflight_once", side_effect=[error, error, error, ([], "current")]) as check, \
                patch.object(cleanup.time, "sleep") as sleep:
            self.assertEqual(cleanup.preflight(), ([], "current"))
            self.assertEqual(check.call_count, 4)
            self.assertEqual([call.args for call in sleep.call_args_list], [(60,), (60,), (60,)])
        with patch.object(cleanup, "preflight_once", side_effect=error), patch.object(cleanup.time, "sleep"):
            with self.assertRaises(cleanup.GuardBlocked):
                cleanup.preflight()

    def test_two_stops_alert_once_then_success_resets(self):
        import tempfile
        import json
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "runs.json"
            def save(data, path=None):
                path.write_text(json.dumps(data), encoding="utf-8")
            error = cleanup.GuardBlocked("critical down", [dict(name="database", state="exited")], False)
            with patch.object(cleanup, "RUNS", target), patch.object(cleanup, "save_state", side_effect=save), \
                    patch.object(cleanup, "journal_alert") as alert:
                cleanup.record_result(error)
                alert.assert_not_called()
                cleanup.record_result(error)
                alert.assert_called_once()
                cleanup.record_result(error)
                alert.assert_called_once()
                cleanup.record_result()
                self.assertEqual(json.loads(target.read_text())["consecutive_stops"], 0)

    def test_repeated_stop_alert_is_local_error_priority_only(self):
        with patch.object(cleanup, "run") as run:
            cleanup.journal_alert("two stops: database")
            self.assertEqual(run.call_args.args[0], ["logger", "-p", "daemon.err", "-t",
                                                     "yokkai-storage", "two stops: database"])
        source = Path(__file__).with_name("storage_maintenance.py").read_text(encoding="utf-8")
        self.assertNotIn("discord_webhook_url", source)
        self.assertNotIn("ALERT_PHP", source)

    def test_no_volume_or_global_prune_command_is_generated(self):
        text = Path(__file__).with_name("storage_maintenance.py").read_text()
        self.assertNotIn('"volume", "prune"', text)
        self.assertNotIn('"system", "prune"', text)
        self.assertNotIn('"--force"', text)


if __name__ == "__main__":
    unittest.main()
