import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createTranslator } from "next-intl";
function load(file, mocks = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX
      }
    }).outputText,
    { exports, require: n => mocks[n] ?? {} }
  );
  return exports;
}
test("thread order keeps each reply below its parent with pagination context, duplicates and unavailable parents", () => {
  const { wallReplyThread } = load("components/wall-post-interactions.tsx");
  const r = (id, parentId, at) => ({
    id,
    parentId,
    createdAt: at,
    text: id,
    author: { name: id }
  });
  const parent = r("parent", null, "2026-01-01"),
    child = r("child", "parent", "2026-01-03"),
    nested = r("nested", "child", "2026-01-04"),
    other = r("other", null, "2026-01-02");
  const items = wallReplyThread({
    items: [nested, child, other],
    threadContext: [parent, child]
  });
  assert.equal(
    items.map(r => r.reply.id).join(","),
    "other,parent,child,nested"
  );
  assert.equal(items[3].parent.id, "child");
  assert.equal(items[3].depth, 2);
  const missing = wallReplyThread({ items: [child] });
  assert.equal(missing[0].depth, 0);
  assert.equal(missing[0].parent, undefined);
  const cycle = wallReplyThread({
    items: [r("a", "b", "2026"), r("b", "a", "2026")]
  });
  assert.equal(new Set(cycle.map(r => r.reply.id)).size, 2);
});
test("comment notification is localized, targets the exact post and reply, and never contains comment text", () => {
  const { notificationItem } = load("lib/notification-item.ts");
  for (const locale of ["en", "fr"]) {
    const t = createTranslator({
      locale,
      messages: JSON.parse(fs.readFileSync(`messages/${locale}.json`, "utf8")),
      namespace: "topbar"
    });
    const n = notificationItem(
      {
        id: "n",
        type: "wall_reply_received",
        referenceId: "c",
        actorPseudo: "Kitsune",
        postOwnerId: "owner+1",
        postId: "p+1",
        replyId: "c+1",
        createdAt: "2026-11-03T08:00:00Z",
        readAt: null
      },
      t,
      "fixed"
    );
    assert.equal(n.href, "/profile/owner%2B1?tab=wall&post=p%2B1&reply=c%2B1");
    assert.equal(n.kind, "reply");
    assert.equal(n.read, false);
    assert.equal(
      n.title,
      locale === "en"
        ? "New reply to your comment"
        : "Nouvelle réponse à ton commentaire"
    );
    assert(n.text.includes("Kitsune"));
  }
});
test("client sends the immutable parent only for nested replies and keeps the legacy root text endpoint", async () => {
  const calls = [];
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync("lib/data/wall-interactions.ts", "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022
        }
      }
    ).outputText,
    {
      exports,
      AbortSignal,
      require: n =>
        n === "@/utils/supabase/client"
          ? {
              createClient: () => ({
                rpc: (name, args) => ({
                  abortSignal: async () => {
                    calls.push({ name, args });
                    return { data: { items: [] }, error: null };
                  }
                })
              })
            }
          : {}
    }
  );
  await exports.liveWallInteractions.reply("post", "child", "Hi", {
    parentId: "parent",
    mediaPath: null,
    gifUrl: null
  });
  assert.equal(calls[0].name, "publish_wall_post_reply_to");
  assert.equal(calls[0].args.p_parent_id, "parent");
  await exports.liveWallInteractions.reply("post", "root", "Hello");
  assert.equal(calls[1].name, "publish_wall_post_reply");
});
