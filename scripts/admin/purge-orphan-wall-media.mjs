import { createClient } from "@supabase/supabase-js";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { removeWallMedia } from "../../lib/server/wall-media-cleanup.mjs";

export async function purgeOrphanWallMedia(
  client,
  { apply = false, confirm, log = console.log } = {}
) {
  let count = 0,
    bytes = 0;
  async function scan(claim, visit) {
    let after = null;
    do {
      const { data, error } = await client.rpc("get_orphan_wall_media", {
        p_after: after,
        p_claim: claim
      });
      if (error)
        throw new Error(
          "Orphan inventory failed. Check the server configuration and migration."
        );
      if (
        !data ||
        !Array.isArray(data.items) ||
        (data.next !== null &&
          (typeof data.next !== "string" ||
            (after !== null && data.next <= after)))
      )
        throw new Error("Invalid orphan inventory");
      await visit(data.items);
      after = data.next;
    } while (after !== null);
  }
  await scan(false, async items => {
    for (const item of items) {
      if (
        typeof item.name !== "string" ||
        !Number.isSafeInteger(item.bytes) ||
        item.bytes < 0
      )
        throw new Error("Invalid orphan metadata");
      log(item.name);
      count++;
      bytes += item.bytes;
    }
  });
  log(
    `Candidates: ${count} objects, ${bytes} bytes (24-hour grace; active cleanup receipts excluded).`
  );
  if (!apply) {
    log("Dry run: nothing deleted.");
    return { count, bytes, deleted: 0 };
  }
  if (!confirm || (await confirm()) !== "PURGE")
    throw new Error("Cancelled: type PURGE at the interactive prompt.");
  let deleted = 0,
    deletedBytes = 0;
  // Rescan and claim after confirmation: stale preview paths never authorize a
  // deletion. Publication and uploads are fenced until Storage deletes a claim.
  await scan(true, async items => {
    await removeWallMedia(
      items.map(item => item.name),
      () => client
    );
    deleted += items.length;
    deletedBytes += items.reduce((n, item) => n + item.bytes, 0);
    log(`Deleted so far: ${deleted} objects, ${deletedBytes} bytes.`);
  });
  log(`Deleted: ${deleted} objects, ${deletedBytes} bytes.`);
  return { count, bytes, deleted };
}

async function main() {
  const { values } = parseArgs({
    options: { apply: { type: "boolean", default: false } }
  });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error("Missing server Supabase environment variables.");
  if (values.apply && (!process.stdin.isTTY || !process.stdout.isTTY))
    throw new Error("--apply requires an interactive terminal.");
  const client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
  await purgeOrphanWallMedia(client, {
    apply: values.apply,
    confirm: async () => {
      const terminal = createInterface({
        input: process.stdin,
        output: process.stdout
      });
      try {
        return await terminal.question(
          "Type PURGE to delete the current orphan objects: "
        );
      } finally {
        terminal.close();
      }
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error(
      "Orphan cleanup failed or cancelled. No credentials are logged. Re-run dry-run; failed claims can be reclaimed after 24 hours."
    );
    process.exitCode = 1;
  });
