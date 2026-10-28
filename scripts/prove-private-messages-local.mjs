import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid");
if (
  url.protocol !== "http:" ||
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  url.port !== "54321"
)
  throw Error("A local Supabase instance on port 54321 is required");
const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
};
const admin = createClient(
  url.origin,
  process.env.SUPABASE_SECRET_KEY,
  options
);
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const created = [];
const clients = [];
async function within(promise, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(message)), 10000);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
try {
  const players = [];
  for (const label of ["Alice", "Bob", "Outsider"]) {
    const token = randomBytes(6).toString("hex");
    const password = randomBytes(24).toString("base64url");
    const email = `messages-${token}@example.test`;
    const result = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { pseudo: `Msg${label}${token}` }
    });
    if (result.error) throw result.error;
    created.push(result.data.user.id);
    const client = createClient(url.origin, publicKey, options);
    clients.push(client);
    const session = await client.auth.signInWithPassword({ email, password });
    if (session.error) throw session.error;
    players.push({ id: result.data.user.id, client });
  }
  const [alice, bob, outsider] = players;
  const request = await alice.client.rpc("send_friend_request", {
    p_friend_id: bob.id
  });
  if (request.error) throw request.error;
  const accepted = await bob.client.rpc("respond_friend_request", {
    p_request_id: request.data,
    p_accept: true
  });
  if (accepted.error) throw accepted.error;
  let incoming;
  const incomingNotification = new Promise(resolve => {
    incoming = resolve;
  });
  let ready, failed;
  const postgresReady = new Promise((resolve, reject) => {
    ready = resolve;
    failed = reject;
  });
  const channel = bob.client
    .channel(`local-private-notification:${randomUUID()}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${bob.id}`
      },
      payload => {
        if (payload.new.type === "private_message_received")
          incoming(payload.new);
      }
    )
    .on("system", {}, payload => {
      if (payload.status === "ok") ready();
      else if (payload.status === "error")
        failed(Error("Local realtime database subscription failed"));
    });
  channel.subscribe(status => {
    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
      failed(Error("Local realtime subscription failed"));
  });
  await within(postgresReady, "Local realtime subscription timed out");
  const id = randomUUID();
  const args = {
    p_friend_id: bob.id,
    p_body: "Local private message proof",
    p_id: id
  };
  const [sent, repeated] = await Promise.all([
    alice.client.rpc("send_private_message", args),
    alice.client.rpc("send_private_message", args)
  ]);
  if (sent.error) throw sent.error;
  assert.equal(sent.data.senderId, alice.id);
  assert.equal(repeated.data?.id, id);
  const realtimeNotice = await within(
    incomingNotification,
    "Local realtime notification timed out"
  );
  assert.equal(realtimeNotice.user_id, bob.id);
  assert.equal(realtimeNotice.actor_user_id, alice.id);
  assert.ok(!JSON.stringify(realtimeNotice).includes(args.p_body));
  const received = await bob.client.rpc("get_private_messages", {
    p_friend_id: alice.id
  });
  if (received.error) throw received.error;
  assert.equal(received.data.items.length, 1);
  assert.equal(received.data.items[0].id, id);
  const notifications = await bob.client.rpc("list_notifications");
  if (notifications.error) throw notifications.error;
  const notice = notifications.data.find(
    item => item.type === "private_message_received"
  );
  assert.equal(notice?.referenceId, alice.id);
  assert.ok(notice?.actorPseudo);
  assert.ok(!JSON.stringify(notice).includes(args.p_body));
  const denied = await outsider.client.rpc("get_private_messages", {
    p_friend_id: alice.id
  });
  assert.equal(denied.error?.message, "MESSAGES_UNAVAILABLE");
  const direct = await bob.client.from("private_messages").select("*");
  assert.ok(direct.error);
  const gifUrl = "https://media.giphy.com/media/test/giphy.gif";
  const gifId = randomUUID();
  const gifArgs = {
    p_friend_id: alice.id,
    p_body: "",
    p_id: gifId,
    p_gif_url: gifUrl
  };
  const [gifSent, gifRetry] = await Promise.all([
    bob.client.rpc("send_private_message_gif", gifArgs),
    bob.client.rpc("send_private_message_gif", gifArgs)
  ]);
  if (gifSent.error) throw gifSent.error;
  assert.equal(gifSent.data.gifUrl, gifUrl);
  assert.equal(gifRetry.data?.id, gifId);
  const gifReceived = await alice.client.rpc("get_private_messages", {
    p_friend_id: bob.id
  });
  if (gifReceived.error) throw gifReceived.error;
  assert.equal(
    gifReceived.data.items.find(message => message.id === gifId)?.gifUrl,
    gifUrl
  );
  const badGif = await bob.client.rpc("send_private_message_gif", {
    ...gifArgs,
    p_id: randomUUID(),
    p_gif_url: "data:image/gif;base64,invalid"
  });
  assert.equal(badGif.error?.message, "MESSAGE_GIF_INVALID");
  const blocked = await bob.client.rpc("block_user", { p_user_id: alice.id });
  if (blocked.error) throw blocked.error;
  const afterBlock = await alice.client.rpc("get_private_messages", {
    p_friend_id: bob.id
  });
  assert.equal(afterBlock.error?.message, "MESSAGES_UNAVAILABLE");
  const hiddenNotifications = await bob.client.rpc("list_notifications");
  if (hiddenNotifications.error) throw hiddenNotifications.error;
  assert.ok(
    !hiddenNotifications.data.some(
      item => item.type === "private_message_received"
    )
  );
  const gifBlocked = await alice.client.rpc("send_private_message_gif", {
    ...gifArgs,
    p_friend_id: bob.id,
    p_id: randomUUID()
  });
  assert.equal(gifBlocked.error?.message, "MESSAGES_UNAVAILABLE");
  console.log(
    "Local Supabase proof passed: authenticated text/GIF send and receive, concurrent idempotent retries, non-GIPHY URL denial, outsider denial, no direct table access, and bilateral block."
  );
} finally {
  await Promise.all(clients.map(client => client.removeAllChannels()));
  for (const id of created) {
    const result = await admin.auth.admin.deleteUser(id);
    if (result.error) throw result.error;
  }
  console.log(
    `Removed ${created.length} disposable local test accounts and their messages.`
  );
}
