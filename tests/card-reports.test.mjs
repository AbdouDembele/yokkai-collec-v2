import { normalizeWhitespace } from "./helpers/normalize-whitespace.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { replayMigrations } from "../scripts/replay-migrations.mjs";

const reporter = "10000000-0000-4000-8000-000000000001";
const admin = "10000000-0000-4000-8000-000000000002";
const card = "20000000-0000-4000-8000-000000000001";

test("card reports are authenticated, deduplicated and admin-audited", async t => {
  const { db } = await replayMigrations();
  t.after(() => db.close());
  await db.exec("alter table auth.users add column email text");
  await db.query(
    "insert into auth.users(id,raw_user_meta_data,email) values ($1,'{\"pseudo\":\"Reporter\"}','reporter@test.local'),($2,'{\"pseudo\":\"Admin\"}','admin@test.local')",
    [reporter, admin]
  );
  await db.query("insert into public.admin_users(user_id) values ($1)", [
    admin
  ]);
  await db.query(
    "insert into public.cards(id,source_id,nom,categorie,franchise,rarete_base,image_url,source) values ($1,'report-test','CARTE TEST','ANIME/MANGA','Licence test','R','https://example.test/card.jpg','manual')",
    [card]
  );
  const as = async (id, sql, args = []) => {
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    try {
      return (await db.query(sql, args)).rows;
    } finally {
      await db.exec("reset role");
    }
  };
  const reportId = (
    await as(reporter, "select public.report_card($1,$2) id", [
      card,
      "image_issue"
    ])
  )[0].id;
  await assert.rejects(
    as(reporter, "select public.report_card($1,$2)", [card, "image_issue"]),
    /REPORT_DUPLICATE/
  );
  await assert.rejects(
    as(reporter, "select public.report_card($1,$2)", [card, "invalid"]),
    /REPORT_INVALID/
  );
  await assert.rejects(
    as(reporter, "select * from public.card_reports"),
    /permission denied/
  );
  const result = (
    await as(admin, "select public.admin_search_card_reports() value")
  )[0].value;
  assert.equal(result.total, 1);
  assert.equal(result.reports[0].cardName, "CARTE TEST");
  assert.equal(result.reports[0].reporterPseudo, "Reporter");
  await as(admin, "select public.admin_set_card_report_status($1,$2)", [
    reportId,
    "reviewed"
  ]);
  assert.equal(
    (
      await db.query("select status from public.card_reports where id=$1", [
        reportId
      ])
    ).rows[0].status,
    "reviewed"
  );
  assert.equal(
    (
      await db.query(
        "select action from public.admin_audit_logs where metadata->>'report_id'=$1",
        [reportId]
      )
    ).rows[0].action,
    "card_report.status.change"
  );
});

test("card reports appear only in detail modals with the three reasons", () => {
  const cardComponent = readFileSync(
    new URL("../components/yokai-card.tsx", import.meta.url),
    "utf8"
  );
  const modal = readFileSync(
    new URL("../components/card-report-button.tsx", import.meta.url),
    "utf8"
  );
  const catalogue = readFileSync(
    new URL("../components/community-views.tsx", import.meta.url),
    "utf8"
  );
  const collection = readFileSync(
    new URL("../components/collection.tsx", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(
    normalizeWhitespace(cardComponent),
    normalizeWhitespace(/CardReportButton|yk-card-report-trigger/)
  );
  assert.match(
    normalizeWhitespace(catalogue),
    normalizeWhitespace(/CardReportButton cardId=\{selected\.id\}/)
  );
  assert.match(
    normalizeWhitespace(collection),
    normalizeWhitespace(/CardReportButton cardId=\{selected\.id\}/)
  );
  for (const reason of ["image_issue", "wrong_license", "duplicate_card"])
    assert.match(modal, new RegExp(reason));
});
