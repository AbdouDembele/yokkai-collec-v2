import assert from "node:assert/strict";
import test from "node:test";
import {
  deliverPush,
  validPushEndpoint
} from "../lib/server/push-delivery.mjs";

test("push sends encrypted payloads, removes only 404/410 subscriptions and preserves transient failures", async () => {
  const removed = [],
    sent = [];
  const subscriptions = [200, 404, 410, 503].map(status => ({
    endpoint: `https://fcm.googleapis.com/send/${status}`,
    p256dh: "key",
    auth: "auth"
  }));
  const failures = await deliverPush(
    subscriptions,
    { title: "Yokkai", body: "Hello", url: "/settings" },
    async (subscription, payload) => {
      sent.push([subscription, JSON.parse(payload)]);
      const statusCode = Number(subscription.endpoint.split("/").pop());
      if (statusCode !== 200) throw { statusCode };
    },
    async endpoint => {
      removed.push(endpoint);
    }
  );
  assert.equal(sent.length, 4);
  assert.deepEqual(sent[0][0].keys, { p256dh: "key", auth: "auth" });
  assert.equal(sent[0][1].url, "/settings");
  assert.deepEqual(
    removed,
    subscriptions.slice(1, 3).map(s => s.endpoint)
  );
  assert.equal(failures, 1);
  for (const endpoint of [
    "http://localhost/send",
    "https://127.0.0.1/",
    "https://fcm.googleapis.com.evil.test/",
    "https://user@fcm.googleapis.com/",
    "https://fcm.googleapis.com:444/"
  ])
    assert.equal(validPushEndpoint(endpoint), false);
  assert.equal(validPushEndpoint("https://web.push.apple.com/Q123"), true);
  assert.equal(
    validPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/123"),
    true
  );
});
