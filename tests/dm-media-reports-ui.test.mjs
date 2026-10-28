import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import { moderateReportedContent } from "../lib/server/admin-wall-content-core.mjs";

const image =
  "37900000-0000-4000-8000-000000000002/37900000-0000-4000-8000-000000000060.png";
const client = (result, authorize = path => path) => {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push(name);
      if (name === "authorize_wall_reply_media_cleanup")
        return { data: authorize(args.p_path), error: null };
      assert.equal(name, "admin_moderate_reported_content");
      return result;
    }
  };
};
const storage =
  (removed, error = null) =>
  () => ({
    storage: {
      from: bucket => {
        assert.equal(bucket, "profile-wall-media");
        return {
          remove: async paths => {
            removed.push(...paths);
            return { error };
          }
        };
      }
    }
  });

test("admin moderation returns stable codes and removes only RPC-authorized files", async () => {
  const removed = [];
  assert.deepEqual(
    await moderateReportedContent(
      client({ data: { alreadyRemoved: false, mediaPaths: [] }, error: null }),
      "report",
      storage(removed)
    ),
    { ok: true, removed: true, code: "removed" }
  );
  assert.deepEqual(removed, [], "a DM has no file to delete");

  const wall = client({
    data: { alreadyRemoved: false, mediaPaths: [image] },
    error: null
  });
  assert.equal(
    (await moderateReportedContent(wall, "report", storage(removed))).code,
    "removed"
  );
  assert.deepEqual(wall.calls, [
    "admin_moderate_reported_content",
    "authorize_wall_reply_media_cleanup"
  ]);
  assert.deepEqual(removed, [image]);

  assert.deepEqual(
    await moderateReportedContent(
      client({
        data: { alreadyRemoved: false, mediaPaths: [image] },
        error: null
      }),
      "report",
      storage([], { message: "down" })
    ),
    { ok: false, removed: true, code: "cleanupFailed" }
  );
  assert.deepEqual(
    await moderateReportedContent(
      client({ data: null, error: { message: "MODERATION_TEXT_REQUIRED" } }),
      "report",
      storage([])
    ),
    { ok: false, code: "textRequired" }
  );
  assert.deepEqual(
    await moderateReportedContent(
      client({ data: null, error: { message: "ADMIN_REQUIRED" } }),
      "report",
      storage([])
    ),
    { ok: false, code: "failed" }
  );
  // A forged path in the RPC response is never sent to Storage.
  const forged = [];
  assert.equal(
    (
      await moderateReportedContent(
        client({
          data: { alreadyRemoved: false, mediaPaths: ["../other.png"] },
          error: null
        }),
        "report",
        storage(forged)
      )
    ).code,
    "cleanupFailed"
  );
  assert.deepEqual(forged, []);
});

test("every moderation code and new admin/DM text exists in English and French", () => {
  for (const file of ["messages/en.json", "messages/fr.json"]) {
    const messages = JSON.parse(readFileSync(file, "utf8"));
    for (const code of [
      "removed",
      "alreadyRemoved",
      "textRequired",
      "cleanupFailed",
      "failed"
    ])
      assert.equal(
        typeof messages.adminReports.result[code],
        "string",
        `${file} ${code}`
      );
    assert.equal(typeof messages.privateMessages.removedByModeration, "string");
  }
});

test("DMs show the moderation notice and offer a report on received messages only", () => {
  const source = readFileSync(
    "components/private-messages.tsx",
    "utf8"
  ).replace(/\s+/g, " ");
  assert.match(
    source,
    /message\.moderated && \( <p className="yk-private-message-removed"> \{t\("removedByModeration"\)\}/
  );
  assert.match(
    source,
    /\{!own && !message\.moderated && \( <PlayerModeration [^>]*contextType="private_message" contextId=\{message\.id\}/
  );
  const admin = readFileSync("app/admin/reports/report-list.tsx", "utf8");
  assert.match(admin, /src=\{`\/api\/admin\/reports\/\$\{reportId\}\/media`\}/);
  assert.match(admin, /t\(`result\.\$\{state\.code\}`\)/);
});

test("admin rows show a reported DM, its GIF and the hide action", () => {
  const require = createRequire(import.meta.url);
  const exports = {};
  const mocks = {
    react: {
      ...React,
      useActionState: () => [{ ok: false, code: "" }, () => {}, false]
    },
    "./actions": {},
    "@/components/ui": { Modal: () => null },
    "next-intl": {
      useTranslations: namespace =>
        createTranslator({
          locale: "en",
          messages: JSON.parse(readFileSync("messages/en.json", "utf8")),
          namespace
        })
    },
    "next/link": {
      __esModule: true,
      default: ({ children, ...props }) =>
        React.createElement("a", props, children)
    }
  };
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync("app/admin/reports/report-list.tsx", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX
        }
      }
    ).outputText,
    {
      exports,
      Error,
      require: name => (name in mocks ? mocks[name] : require(name))
    }
  );
  const html = renderToStaticMarkup(
    React.createElement(exports.ReportList, {
      playerHrefBase: "/admin/reports?player=",
      reports: [
        {
          id: "report",
          reporterId: "bob",
          reporterPseudo: "Bob",
          reportedId: "alice",
          reportedPseudo: "Alice",
          reason: "harassment",
          contextType: "private_message",
          contextId: "message",
          snapshot: {
            message: "Rude words",
            gifUrl: "https://media.giphy.com/media/abc/giphy.gif"
          },
          details: "",
          status: "pending",
          createdAt: "2026-10-28T00:00:00Z"
        }
      ]
    })
  );
  assert.match(html, />Private message</);
  assert.match(html, /Rude words/);
  assert.match(
    html,
    /<img[^>]*src="https:\/\/media\.giphy\.com\/media\/abc\/giphy\.gif"[^>]*alt="Reported GIF"/
  );
  assert.match(html, />Hide message</);
  assert.doesNotMatch(html, /Delete content/, "DMs are hidden, not deleted");
});
