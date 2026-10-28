import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import test from "node:test";
import {
  parseOptions,
  validateJournal,
  exportJournal,
  reapplyJournal
} from "../scripts/reapply-account-deletions.mjs";
const id = "10000000-0000-4000-8000-000000000001",
  url = "https://example.test";
const entry = { user_id: id, deleted_at: "2026-10-11T10:00:00Z" };
const journal = {
  version: 1,
  project_url: url,
  exported_at: "2026-10-11T11:00:00Z",
  deletions: [entry]
};
test("restoration defaults to dry-run and refuses ambiguous or bypass flags", () => {
  assert.deepEqual(parseOptions(["--journal", "private.json"]), {
    apply: false,
    journal: "private.json"
  });
  assert.deepEqual(parseOptions(["--journal", "private.json", "--apply"]), {
    apply: true,
    journal: "private.json"
  });
  for (const args of [
    [],
    ["--apply"],
    ["--journal"],
    ["--export", "a", "--apply"],
    ["--journal", "a", "--export", "b"],
    ["--journal", "a", "--yes"]
  ])
    assert.throws(() => parseOptions(args));
});
test("journal binds target and rejects invalid, duplicate, future or excess personal fields", () => {
  assert.deepEqual(validateJournal(journal, url), [entry]);
  for (const bad of [
    { ...journal, project_url: "https://wrong.test" },
    { ...journal, exported_at: "bad" },
    { ...journal, deletions: [entry, entry] },
    { ...journal, deletions: [{ ...entry, email: "private" }] },
    { ...journal, deletions: [{ ...entry, user_id: "bad" }] },
    {
      ...journal,
      deletions: [{ ...entry, deleted_at: "2027-01-01T00:00:00Z" }]
    }
  ])
    assert.throws(() => validateJournal(bad, url));
});
test("export reads only UUID/date and keyset-paginates beyond 1000 entries", async () => {
  const entries = Array.from({ length: 1001 }, (_, i) => ({
    ...entry,
    user_id: `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`
  }));
  let reads = 0;
  const admin = {
    from: table => {
      assert.equal(table, "account_deletion_log");
      const q = {
        select: columns => {
          assert.equal(columns, "user_id,deleted_at");
          return q;
        },
        order: column => {
          assert.equal(column, "user_id");
          return q;
        },
        limit: n => {
          assert.equal(n, 1000);
          return q;
        },
        gt: (column, last) => {
          assert.equal(column, "user_id");
          assert.equal(last, entries[999].user_id);
          return q;
        },
        then: resolve =>
          resolve({
            data: reads++ === 0 ? entries.slice(0, 1000) : entries.slice(1000),
            error: null
          })
      };
      return q;
    }
  };
  assert.equal((await exportJournal(admin, url)).deletions.length, 1001);
  assert.equal(reads, 2);
});
test("reapplication uses shared ordered cleanup, hard Auth deletion, and stops without retry", async () => {
  const calls = [];
  const admin = {
    from: table => ({
      update: row => ({
        eq: (column, uuid) => ({
          gt: async (dateColumn, date) => {
            assert.equal(table, "account_deletion_log");
            assert.deepEqual(row, { deleted_at: entry.deleted_at });
            assert.equal(column, "user_id");
            assert.equal(uuid, id);
            assert.equal(dateColumn, "deleted_at");
            assert.equal(date, entry.deleted_at);
            calls.push("journal-date");
            return { error: null };
          }
        })
      })
    }),
    rpc: async name => {
      calls.push(name);
      return { data: [], error: null };
    },
    storage: {
      from: () => {
        assert.fail("empty manifest");
      }
    },
    auth: {
      admin: {
        deleteUser: async (uuid, soft) => {
          calls.push([uuid, soft]);
          return { error: { code: "user_not_found" } };
        }
      }
    }
  };
  await reapplyJournal(admin, [entry]);
  assert.deepEqual(calls, [
    "begin_account_deletion",
    "prepare_account_deletion",
    [id, false],
    "journal-date"
  ]);
  let attempts = 0;
  admin.rpc = async () => {
    attempts++;
    return { error: { message: "SECRET_PROVIDER_DETAIL" } };
  };
  await assert.rejects(
    reapplyJournal(admin, [entry, entry]),
    error =>
      error.message.includes("REAPPLICATION_STOPPED") &&
      !error.message.includes("SECRET")
  );
  assert.equal(attempts, 1);
});

test("CLI dry-run makes no network writes and apply refuses a noninteractive caller", t => {
  const dir = mkdtempSync(path.join(tmpdir(), "deletion-journal-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "journal.json");
  writeFileSync(file, JSON.stringify(journal));
  const options = {
    encoding: "utf8",
    env: {
      ...process.env,
      SUPABASE_URL: url,
      SUPABASE_SECRET_KEY: "TEST_ONLY_PRIVATE_KEY"
    },
    timeout: 5000
  };
  const cli = new URL(
    "../scripts/reapply-account-deletions.mjs",
    import.meta.url
  );
  const dry = spawnSync(
    process.execPath,
    [fileURLToPath(cli), "--journal", file],
    options
  );
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /DRY-RUN: no writes/);
  assert.doesNotMatch(dry.stdout + dry.stderr, /TEST_ONLY_PRIVATE_KEY/);
  const apply = spawnSync(
    process.execPath,
    [fileURLToPath(cli), "--journal", file, "--apply"],
    options
  );
  assert.equal(apply.status, 1);
  assert.match(apply.stderr, /INTERACTIVE_CONFIRMATION_REQUIRED/);
  assert.doesNotMatch(apply.stdout + apply.stderr, /TEST_ONLY_PRIVATE_KEY/);
});
