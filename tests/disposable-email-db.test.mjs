import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { replayMigrations } from "../scripts/replay-migrations.mjs";
import {
  domainRules,
  renderRules
} from "../scripts/update-disposable-email-domains.mjs";
const snapshot = JSON.parse(
  readFileSync("data/disposable-email-domains.json", "utf8")
);

test("indexed SQL policy matches the local snapshot and enforces insertion for every Auth creator", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  const records = (
    await db.query(
      'select domain,allowed from public.signup_email_domain_rules order by domain collate "C"'
    )
  ).rows.map(r => [r.domain, r.allowed]);
  assert.deepEqual(records, domainRules(snapshot));
  const misses = (
    await db.query(
      "select domain from public.signup_email_domain_rules where not allowed and not public.is_disposable_email('proof@'||domain)"
    )
  ).rows;
  assert.deepEqual(
    misses,
    [],
    "Every blocked canonical or Unicode spelling must actually be refused"
  );
  for (const [email, blocked] of [
    ["test@gmail.com", false],
    ["test@outlook.com", false],
    ["test@icloud.com", false],
    ["test@proton.me", false],
    ["test@yopmail.com", true],
    [" USER@MAILINATOR.COM \t", true],
    ["test@a.b.yopmail.com", true],
    ["test@ｙｏｐｍａｉｌ.com", true],
    ["test@yop\u00admail.com", true],
    ["test@yo\u200bpmail.com", true],
    ["test@yop\u034fmail.com", true],
    ["invalid", false],
    [null, false],
    ["test@yopmail.com.evil.test", false]
  ])
    assert.equal(
      (await db.query("select public.is_disposable_email($1) value", [email]))
        .rows[0].value,
      blocked,
      email
    );
  await db.exec("alter table auth.users add column email text");
  // Add only an isolated test role; real GoTrue writes with this role.
  await db.exec(
    "create role supabase_auth_admin; grant usage on schema auth to supabase_auth_admin; grant insert on auth.users to supabase_auth_admin"
  );
  await db.exec("set role supabase_auth_admin");
  for (const provider of ["email", "google", "discord"]) {
    await assert.rejects(
      db.query(
        "insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values(gen_random_uuid(),'x@sub.yopmail.com',$1,$2)",
        [
          JSON.stringify({ pseudo: "Blocked" + provider }),
          JSON.stringify({ provider })
        ]
      ),
      /DISPOSABLE_EMAIL_NOT_ALLOWED/
    );
  }
  await db.exec("reset role");
  await assert.rejects(
    db.exec(
      "insert into auth.users(id,email,raw_user_meta_data) values(gen_random_uuid(),'x@mailinator.com','{\"pseudo\":\"AdminBlocked\"}')"
    ),
    /DISPOSABLE_EMAIL_NOT_ALLOWED/
  );
  assert.equal(
    (await db.query("select count(*)::int value from auth.users")).rows[0]
      .value,
    0
  );
  await db.exec(
    "insert into auth.users(id,email,raw_user_meta_data) values('71100000-0000-4000-8000-000000000001','x@gmail.com','{\"pseudo\":\"AllowedSignup\"}')"
  );
  assert.equal(
    (await db.query("select count(*)::int value from public.user_profiles"))
      .rows[0].value,
    1
  );
  // Existing accounts and email/confirmation updates stay untouched by INSERT policy.
  await db.exec(
    "update auth.users set email='legacy@yopmail.com',email_confirmed_at=now() where id='71100000-0000-4000-8000-000000000001'"
  );
  assert.equal(
    (await db.query("select email from auth.users")).rows[0].email,
    "legacy@yopmail.com"
  );
  for (const role of ["anon", "authenticated", "service_role"]) {
    const access = (
      await db.query(
        "select has_table_privilege($1,'public.signup_email_domain_rules','SELECT') table_read,has_function_privilege($1,'public.is_disposable_email(text)','EXECUTE') checker,has_function_privilege($1,'public.guard_disposable_signup()','EXECUTE') guard",
        [role]
      )
    ).rows[0];
    assert.deepEqual(access, {
      table_read: false,
      checker: false,
      guard: false
    });
  }
  const triggers = (
    await db.query(
      "select tgname from pg_trigger where tgrelid='auth.users'::regclass and not tgisinternal"
    )
  ).rows.map(x => x.tgname);
  assert(triggers.includes("on_auth_user_created_profile"));
  assert(triggers.includes("on_auth_user_confirmed_referral"));
  assert(triggers.includes("before_auth_user_created_disposable_email"));
});

test("initial policy migration remains reproducible from its recorded source snapshot", () => {
  const template = readFileSync(
    "scripts/sql/disposable-email-policy.sql",
    "utf8"
  );
  const expected = template.replace(
    "-- @DOMAIN_RULES@",
    renderRules(domainRules(snapshot))
  );
  assert.equal(
    readFileSync(
      "supabase/migrations/20261031170000_disposable_signup_policy.sql",
      "utf8"
    ),
    expected
  );
});
