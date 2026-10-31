import assert from "node:assert/strict";
import test from "node:test";
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  rmSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep, basename } from "node:path";
import { performance } from "node:perf_hooks";
import { loadDisposableEmail } from "./helpers/disposable-email.mjs";
import {
  validateDomainList,
  updateDomains
} from "../scripts/update-disposable-email-domains.mjs";
const snapshot = JSON.parse(
  readFileSync("data/disposable-email-domains.json", "utf8")
);
const { isDisposableEmail, signupEmailDomain } = loadDisposableEmail();
function cleanup(directory) {
  assert(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  assert(basename(directory).startsWith("yokkai-domain-"));
  rmSync(directory, { recursive: true, force: true });
}

test("permanent providers and invalid input are handled without changing login validation", () => {
  for (const domain of snapshot.allowlist)
    assert.equal(isDisposableEmail("test@" + domain), false, domain);
  for (const value of [
    null,
    undefined,
    42,
    {},
    "",
    "invalid address",
    "a@@yopmail.com",
    "a@.yopmail.com",
    "a@yopmail..com",
    "a@-yopmail.com",
    "a@yopmail.com/path",
    "a@yopmail.com:443",
    "a@%79opmail.com",
    "a@",
    "a@com",
    "a".repeat(260) + "@yopmail.com"
  ]) {
    assert.equal(signupEmailDomain(value), undefined);
    assert.equal(isDisposableEmail(value), false);
  }
});
test("official blocked domains cannot be evaded by case, spaces, subdomains or label suffix tricks", () => {
  for (const domain of ["yopmail.com", "mailinator.com", "10minutemail.com"]) {
    assert(snapshot.domains.includes(domain));
    for (const email of [
      "test@" + domain,
      " USER@" + domain.toUpperCase() + " \t",
      "test@sub.deep." + domain,
      "test@" + domain + "."
    ])
      assert.equal(isDisposableEmail(email), true, email);
  }
  assert.equal(isDisposableEmail("test@yopmail.com.evil.example"), false);
  assert.equal(isDisposableEmail("test@notyopmail.com"), false);
  assert.equal(isDisposableEmail("test@ｙｏｐｍａｉｌ.com"), true);
});
test("explicit allowlist takes priority even if upstream accidentally includes a legitimate provider", () => {
  const api = loadDisposableEmail({
    ...snapshot,
    domains: [...snapshot.domains, "gmail.com", "com"]
  });
  assert.equal(api.isDisposableEmail("test@gmail.com"), false);
  assert.equal(
    api.isDisposableEmail("test@evilgmail.com"),
    false,
    "Never match a single-label public suffix"
  );
});
test("local lookups use a bounded suffix walk and the list never enters a client module", t => {
  const start = performance.now();
  for (let i = 0; i < 10_000; i++)
    assert.equal(isDisposableEmail("user" + i + "@sub.mailinator.com"), true);
  t.diagnostic(
    `10000 local Set checks: ${(performance.now() - start).toFixed(1)} ms`
  );
  assert.match(
    readFileSync("lib/server/disposable-email.ts", "utf8"),
    /import "server-only"/
  );
  assert.doesNotMatch(
    readFileSync("components/auth-form.tsx", "utf8"),
    /disposable-email-domains/
  );
});
test("updater rejects outages, malformed lists and public suffixes before replacing the snapshot", async t => {
  const directory = mkdtempSync(join(tmpdir(), "yokkai-domain-policy-"));
  t.after(() => cleanup(directory));
  mkdirSync(join(directory, "data"));
  mkdirSync(join(directory, "supabase"));
  mkdirSync(join(directory, "supabase", "migrations"));
  const previous = JSON.stringify(snapshot);
  writeFileSync(
    join(directory, "data", "disposable-email-domains.json"),
    previous
  );
  writeFileSync(
    join(directory, "data", "disposable-email-allowlist.json"),
    JSON.stringify(snapshot.allowlist)
  );
  for (const fetchImpl of [
    async () => {
      throw new Error("offline");
    },
    async () => new Response("unavailable", { status: 503 }),
    async url =>
      new Response(
        url.includes("api.github.com")
          ? JSON.stringify([{ sha: "a".repeat(40) }])
          : "<html>error</html>"
      )
  ]) {
    await assert.rejects(updateDomains({ directory, fetchImpl }));
    assert.equal(
      readFileSync(
        join(directory, "data", "disposable-email-domains.json"),
        "utf8"
      ),
      previous
    );
    assert.deepEqual(
      readdirSync(join(directory, "supabase", "migrations")),
      []
    );
  }
  for (const domain of [
    "com",
    "co.uk",
    "github.io",
    "pages.dev",
    "workers.dev",
    "com.au",
    "127.0.0.1",
    "evil.test/path",
    "bad_domain.com"
  ])
    assert.throws(() =>
      validateDomainList(snapshot.domains.join("\n") + "\n" + domain)
    );
  const normalized = validateDomainList(
    snapshot.domains.join("\n") + "\n YOPMAIL.COM \n"
  );
  assert.deepEqual(normalized, snapshot.domains);
  assert.throws(() =>
    validateDomainList(
      snapshot.domains.slice(0, 100).join("\n"),
      snapshot.domains.length
    )
  );
});
test("valid refresh generates a new minimal migration and does not rewrite applied migration history", async t => {
  const directory = mkdtempSync(join(tmpdir(), "yokkai-domain-refresh-"));
  t.after(() => cleanup(directory));
  mkdirSync(join(directory, "data"));
  mkdirSync(join(directory, "supabase"));
  mkdirSync(join(directory, "supabase", "migrations"));
  writeFileSync(
    join(directory, "data", "disposable-email-domains.json"),
    JSON.stringify(snapshot)
  );
  writeFileSync(
    join(directory, "data", "disposable-email-allowlist.json"),
    JSON.stringify(snapshot.allowlist)
  );
  const historical = join(
    directory,
    "supabase",
    "migrations",
    "20261031170000_old.sql"
  );
  writeFileSync(historical, "historical");
  const content = snapshot.domains
    .filter(d => d !== "10minutemail.com")
    .concat("new-disposable.test")
    .join("\n");
  const fetchImpl = async url =>
    new Response(
      url.includes("api.github.com")
        ? JSON.stringify([{ sha: "b".repeat(40) }])
        : content
    );
  const result = await updateDomains({
    directory,
    fetchImpl,
    now: new Date("2026-11-02T06:17:00Z")
  });
  assert.equal(result.changed, true);
  assert.equal(result.count, snapshot.domains.length);
  assert.equal(readFileSync(historical, "utf8"), "historical");
  const migration = readFileSync(
    join(directory, "supabase", "migrations", result.migration),
    "utf8"
  );
  assert.match(migration, /delete from public.signup_email_domain_rules/);
  assert.match(migration, /new-disposable.test/);
  assert.doesNotMatch(migration, /auth\.users|alter table|create trigger/i);
});
