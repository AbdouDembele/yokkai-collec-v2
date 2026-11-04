import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createTranslator } from "next-intl";

const exports = {};
vm.runInNewContext(
  ts.transpileModule(readFileSync("lib/notification-item.ts", "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText,
  { exports, require: () => ({}) }
);
test("accepted-friend notification has EN/FR text, preserves the pseudo and links to the accepter's profile", () => {
  for (const locale of ["en", "fr"]) {
    const t = createTranslator({
      locale,
      messages: JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")),
      namespace: "topbar"
    });
    const base = {
      id: "n",
      type: "friend_request_accepted",
      referenceId: "83000000-0000-4000-8000-000000000002",
      actorPseudo: "Kitsune {test}",
      createdAt: "2026-11-04T10:00:00Z",
      readAt: null
    };
    const item = exports.notificationItem(base, t, "Now");
    assert.equal(item.kind, "friend");
    assert.equal(item.href, `/profile/${base.referenceId}`);
    assert.equal(item.read, false);
    assert.equal(
      item.title,
      locale === "fr" ? "Demande d’ami acceptée" : "Friend request accepted"
    );
    assert.equal(
      item.text,
      locale === "fr"
        ? "Kitsune {test} a accepté ta demande d’ami."
        : "Kitsune {test} accepted your friend request."
    );
    assert.equal(
      exports.notificationItem({ ...base, readAt: base.createdAt }, t).read,
      true
    );
    const missing = exports.notificationItem({ ...base, actorPseudo: null }, t);
    assert.equal(missing.href, "/friends");
    assert.ok(!missing.text.includes("null"));
  }
});
