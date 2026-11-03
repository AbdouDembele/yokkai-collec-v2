import test from "node:test";
import assert from "node:assert/strict";
import { renderRelated } from "./helpers/related-account-render.mjs";
const subject = "ac680000-0000-4000-8000-000000000001",
  active = "ac680000-0000-4000-8000-000000000002",
  deleted = "ac680000-0000-4000-8000-000000000003",
  processed = "ac680000-0000-4000-8000-000000000004";
const checkbox = (html, id) =>
  html.match(
    new RegExp(`<input[^>]*name="source_account"[^>]*value="${id}"[^>]*>`)
  )[0];
test("existing and deleted sources share a named, explicit, searchable view in EN/FR", async () => {
  for (const locale of ["en", "fr"]) {
    const html = await renderRelated(locale);
    assert.match(html, /Faker/);
    assert.match(html, /Former collector/);
    assert.match(html, /Sanctioned source/);
    assert.match(html, /name="linked_q"/);
    assert.match(html, /name="linked_status"/);
    assert.doesNotMatch(
      html,
      /<select\b[^>]*name="primary"|MISSING_MESSAGE|INVALID_MESSAGE/
    );
    assert.match(
      html,
      locale === "fr" ? /2 échanges acceptés/ : /2 accepted trades/
    );
    assert.match(
      html,
      locale === "fr"
        ? /Connexion Internet commune · 7 jours/
        : /Shared Internet connection · 7 days/
    );
    assert.match(
      html,
      locale === "fr"
        ? /Navigateur commun non confirmé/
        : /Shared browser not confirmed/
    );
    assert.match(checkbox(html, processed), /disabled=""/);
    assert.doesNotMatch(checkbox(html, deleted), /disabled=""/);
    assert.match(
      html,
      locale === "fr"
        ? /Cartes reçues par ce dossier/
        : /Cards received by this case/
    );
    assert.match(
      html,
      locale === "fr"
        ? /Cartes envoyées par ce dossier/
        : /Cards sent by this case/
    );
  }
});
test("named active previews retain explicit roles; deleted subjects retarget the surviving primary safely", async () => {
  let html = await renderRelated("en", { role: "smurf" });
  const link = html
    .match(/href="([^"]+primary=[^"]+)"/)[1]
    .replaceAll("&amp;", "&");
  const url = new URL(link, "https://example.invalid");
  assert.equal(url.searchParams.get("sanction"), subject);
  assert.equal(url.searchParams.get("primary"), active);
  assert.equal(url.searchParams.get("role"), "smurf");
  assert.match(checkbox(html, deleted), /disabled=""/);
  html = await renderRelated("en", { removed: "1", role: "smurf" });
  const links = [...html.matchAll(/href="([^"]+)"/g)].map(
    m => new URL(m[1].replaceAll("&amp;", "&"), "https://example.invalid")
  );
  const target = links.find(u => u.searchParams.get("sanction") === active);
  assert.equal(target.searchParams.get("mode"), "deleted");
  assert.equal(target.searchParams.get("source_account"), subject);
  assert.equal(target.searchParams.get("role"), "primary");
});
test("saved deleted selections survive filters and pagination; connection-only accounts expose context without a sanction action", async () => {
  let html = await renderRelated("fr", {
    source_account: deleted,
    linked_page: "2"
  });
  assert.match(
    html,
    new RegExp(`type="hidden" name="source_account" value="${deleted}"`)
  );
  assert.match(html, /source_account=ac680000-0000-4000-8000-000000000003/);
  const household = html.match(
    /data-related-account="ac680000-0000-4000-8000-000000000006"[\s\S]*?<\/article>/
  )[0];
  assert.doesNotMatch(household, /href=/);
  assert.match(household, /Contexte uniquement/);
  html = await renderRelated("en", {
    source_account: Array.from(
      { length: 21 },
      (_, i) => `ac680000-0000-4000-8000-${String(i + 20).padStart(12, "0")}`
    )
  });
  assert.match(html, /role="alert"/);
  assert.match(html, /at most 20/);
});
