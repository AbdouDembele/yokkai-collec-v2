// Real GoTrue proof, deliberately restricted to the local Supabase CLI stack.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
const origin = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert(
  origin && ["127.0.0.1", "localhost"].includes(new URL(origin).hostname),
  "LOCAL Supabase URL required"
);
const inspect = spawnSync("docker", ["inspect", "supabase_auth_Kara"], {
  encoding: "utf8"
});
assert.equal(inspect.status, 0, "Local Auth container required");
const config = JSON.parse(inspect.stdout)[0];
const authEnv = Object.fromEntries(
  config.Config.Env.map(value => {
    const offset = value.indexOf("=");
    return [value.slice(0, offset), value.slice(offset + 1)];
  })
);
assert.equal(
  authEnv.GOTRUE_SMTP_HOST,
  "supabase_inbucket_Kara",
  "Never send proof emails through a real SMTP service"
);
const gateway = spawnSync("docker", ["inspect", "supabase_kong_Kara"], {
  encoding: "utf8"
});
assert.equal(gateway.status, 0, "Local gateway required");
const ports =
  JSON.parse(gateway.stdout)[0].NetworkSettings.Ports["8000/tcp"] ?? [];
assert(
  new URL(origin).protocol === "http:" &&
    ports.some(port => port.HostPort === new URL(origin).port),
  "URL must target this exact local CLI gateway"
);
const errorResponses = [];
const options = {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      if (response.status >= 400) {
        let body;
        try {
          body = await response.clone().json();
        } catch {}
        errorResponses.push({
          status: response.status,
          code:
            typeof body?.code === "string"
              ? body.code
              : (body?.error_code ?? "missing")
        });
      }
      return response;
    }
  }
};
const client = () =>
  createClient(
    origin,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    options
  );
const admin = createClient(
  origin,
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
  options
);
function sql(code) {
  const r = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_Kara",
      "psql",
      "-X",
      "-w",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1"
    ],
    { input: code, encoding: "utf8" }
  );
  assert.equal(r.status, 0, "Local proof SQL failed");
  return r.stdout.trim();
}
if (
  sql("select to_regclass('public.signup_email_domain_rules') is not null") !==
  "t"
) {
  assert(
    process.argv.includes("--install-local-policy"),
    "Install the local policy explicitly first"
  );
  sql(
    readFileSync(
      new URL(
        "../supabase/migrations/20261031170000_disposable_signup_policy.sql",
        import.meta.url
      ),
      "utf8"
    )
  );
}
const tag = "policy-proof-" + Date.now(),
  password = randomUUID() + "aA1!",
  addresses = new Set(),
  ids = new Set(),
  proof = {};
function email(suffix, domain) {
  const value = tag + "-" + suffix + "@" + domain;
  addresses.add(value);
  return value;
}
const data = {
  pseudo: "Policy" + Date.now(),
  signup_policies: {
    version: "2026-10-20",
    accepted_at: new Date().toISOString()
  }
};
try {
  const denied = [
    [
      "signup",
      () =>
        client().auth.signUp({
          email: email("signup", "yopmail.com"),
          password,
          options: { data }
        })
    ],
    [
      "otp",
      () =>
        client().auth.signInWithOtp({
          email: email("otp", "mailinator.com"),
          options: { shouldCreateUser: true, data }
        })
    ],
    [
      "admin-create",
      () =>
        admin.auth.admin.createUser({
          email: email("admin", "yopmail.com"),
          password,
          user_metadata: data,
          email_confirm: true
        })
    ],
    [
      "invite",
      () =>
        admin.auth.admin.inviteUserByEmail(email("invite", "mailinator.com"), {
          data
        })
    ],
    [
      "generate-link",
      () =>
        admin.auth.admin.generateLink({
          type: "signup",
          email: email("link", "yopmail.com"),
          password,
          options: { data }
        })
    ]
  ];
  proof.denied = [];
  for (const [name, call] of denied) {
    const result = await call();
    if (result.data?.user?.id) ids.add(result.data.user.id);
    assert(
      result.error && !result.data?.user,
      "Expected backend denial: " + name
    );
    assert.equal(
      errorResponses.at(-1)?.code,
      "unexpected_failure",
      `Expected trigger refusal: ${name}, status=${result.error.status}, kind=${result.error.name}`
    );
    proof.denied.push(name);
  }
  proof.normalizedVariants = [];
  for (const [name, domain] of [
    ["uppercase", "Sub.YOPMAIL.COM"],
    ["fullwidth", "ｙｏｐｍａｉｌ.com"],
    ["soft-hyphen", "yop\u00admail.com"],
    ["zero-width", "yo\u200bpmail.com"]
  ]) {
    const result = await client().auth.signUp({
      email: email(name, domain),
      password,
      options: { data }
    });
    if (result.data?.user?.id) ids.add(result.data.user.id);
    assert(
      result.error && !result.data?.user,
      "Normalized domain must be denied: " + name
    );
    assert(
      [
        "unexpected_failure",
        "email_address_invalid",
        "validation_failed"
      ].includes(errorResponses.at(-1)?.code),
      "Policy or Auth-format refusal required: " + name
    );
    proof.normalizedVariants.push(name);
  }
  const normal = email("normal", "gmail.com"),
    sessionClient = client();
  const created = await sessionClient.auth.signUp({
    email: normal,
    password,
    options: { data }
  });
  assert(
    !created.error && created.data?.user?.id,
    "Normal signup must succeed"
  );
  ids.add(created.data.user.id);
  proof.normalSignup = true;
  if (!created.data.user.email_confirmed_at) {
    const link = await admin.auth.admin.generateLink({
      type: "signup",
      email: normal,
      password
    });
    assert(
      !link.error && link.data.properties.hashed_token,
      "Normal signup confirmation link"
    );
    assert.equal(
      (
        await sessionClient.auth.verifyOtp({
          type: "signup",
          token_hash: link.data.properties.hashed_token
        })
      ).error,
      null,
      "Normal signup confirmation"
    );
  }
  assert.equal(
    (await sessionClient.auth.signInWithPassword({ email: normal, password }))
      .error,
    null,
    "Existing login"
  );
  proof.login = true;
  assert.equal((await sessionClient.auth.signOut()).error, null, "Logout");
  assert.equal((await sessionClient.auth.getSession()).data.session, null);
  proof.logout = true;
  const legacy = email("legacy", "yopmail.com");
  assert.equal(
    (
      await admin.auth.admin.updateUserById(created.data.user.id, {
        email: legacy,
        email_confirm: true
      })
    ).error,
    null,
    "Only the newly created local fixture is changed"
  );
  assert.equal(
    (await sessionClient.auth.signInWithPassword({ email: legacy, password }))
      .error,
    null,
    "Existing disposable-address account must still log in"
  );
  proof.existingDisposableLogin = true;
  await sessionClient.auth.signOut();
  assert.equal(
    (
      await sessionClient.auth.resetPasswordForEmail(legacy, {
        redirectTo: "http://127.0.0.1:3000/reset-password"
      })
    ).error,
    null,
    "Existing-account password recovery"
  );
  // Generate the same recovery-token type without reading or printing a mailbox.
  const recovery = await admin.auth.admin.generateLink({
    type: "recovery",
    email: legacy
  });
  assert(
    !recovery.error && recovery.data.properties.hashed_token,
    "Recovery link"
  );
  const recovered = await sessionClient.auth.verifyOtp({
    type: "recovery",
    token_hash: recovery.data.properties.hashed_token
  });
  assert(!recovered.error && recovered.data.session, "Recovery verification");
  assert.equal(
    (await sessionClient.auth.updateUser({ password: randomUUID() + "bB2!" }))
      .error,
    null,
    "Reset password"
  );
  proof.passwordRecovery = true;
  await sessionClient.auth.signOut();
  const confirmation = email("confirmation", "outlook.com");
  const pending = await admin.auth.admin.createUser({
    email: confirmation,
    password,
    email_confirm: false,
    user_metadata: { ...data, pseudo: "Verify" + Date.now() }
  });
  assert(!pending.error && pending.data.user?.id, "Unconfirmed local fixture");
  ids.add(pending.data.user.id);
  assert.equal(
    pending.data.user.email_confirmed_at,
    undefined,
    "Fixture must need confirmation"
  );
  const link = await admin.auth.admin.generateLink({
    type: "signup",
    email: confirmation,
    password
  });
  assert(!link.error && link.data.properties.hashed_token, "Confirmation link");
  const verified = await client().auth.verifyOtp({
    type: "signup",
    token_hash: link.data.properties.hashed_token
  });
  assert(
    !verified.error && verified.data.user?.email_confirmed_at,
    "Email confirmation must still succeed"
  );
  proof.emailConfirmation = true;
  const escaped = [...addresses]
    .map(value => "'" + value.replaceAll("'", "''") + "'")
    .join(",");
  const actual = JSON.parse(
    sql(
      `select coalesce(json_agg(id),'[]') from auth.users where email in (${escaped})`
    )
  );
  assert.equal(
    actual.length,
    2,
    "Denied alternate routes must not leave Auth rows"
  );
  for (const id of actual) ids.add(id);
} finally {
  for (const id of ids) {
    assert.match(id, /^[a-f0-9-]{36}$/);
    assert.equal(
      (await admin.auth.admin.deleteUser(id)).error,
      null,
      "Clean only this proof's local fixtures"
    );
  }
}
console.log(
  JSON.stringify({
    ...proof,
    fixturesCleaned: ids.size,
    productionTouched: false,
    realEmailsSent: false
  })
);
