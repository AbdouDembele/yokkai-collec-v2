import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
  existsSync
} from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

export const MEDIA_QUERY = `query($ids:[Int]){Page(perPage:50){media(id_in:$ids){id type format season seasonYear startDate{year month day} title{english romaji native} synonyms siteUrl relations{edges{relationType node{id type title{english romaji}}}}}}}`;

export function rateDelay(headers, now = Date.now()) {
  const retry = headers.get("retry-after");
  const retryMs = /^\d+(\.\d+)?$/.test(retry ?? "")
    ? Number(retry) * 1000
    : Math.max(0, Date.parse(retry ?? "") - now) || 0;
  const resetMs = Math.max(
    0,
    Number(headers.get("x-ratelimit-reset") ?? 0) * 1000 - now
  );
  return Math.max(retryMs, resetMs, 60000);
}

export async function fetchScopedMedia(
  ids,
  {
    request = fetch,
    sleep = delay,
    now = Date.now,
    checkpoint = () => {},
    cached = {},
    purpose,
    commercialUsageConfirmed = false,
    onError = () => {}
  } = {}
) {
  if (
    purpose !== "Yokkai current Anime/Manga catalogue audit" ||
    !commercialUsageConfirmed
  )
    throw new Error(
      "AniList usage and limited audit purpose must be confirmed before requests."
    );
  const scope = [...new Set(ids)].sort((a, b) => a - b);
  if (
    scope.length > 6500 ||
    scope.some(id => !Number.isSafeInteger(id) || id <= 0)
  )
    throw new Error(
      "Invalid or excessive explicit local-catalogue scope. No catalogue crawl is allowed."
    );
  const result = {};
  const maxAge = 7 * 86400000;
  for (const id of scope) {
    const entry = cached[id];
    if (
      entry &&
      now() - Date.parse(entry.fetched_at) < maxAge &&
      now() >= Date.parse(entry.fetched_at)
    )
      result[id] = entry;
  }
  const pending = scope.filter(id => !result[id]);
  let nextRequestAt = 0;
  for (let offset = 0; offset < pending.length; offset += 50) {
    const batch = pending.slice(offset, offset + 50);
    let response, body;
    for (let attempt = 0; ; attempt++) {
      await sleep(Math.max(0, nextRequestAt - now()));
      nextRequestAt = now() + 2500; // Below the currently documented degraded 30/minute limit.
      try {
        response = await request("https://graphql.anilist.co", {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(30000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: MEDIA_QUERY,
            variables: { ids: batch }
          })
        });
      } catch (error) {
        onError({
          ids: batch,
          attempt,
          code: "NETWORK",
          message: String(error.message)
        });
        if (attempt >= 3) throw error;
        nextRequestAt = now() + Math.min(30000, 2500 * 2 ** attempt);
        continue;
      }
      if (response.status === 429) {
        onError({ ids: batch, attempt, code: "RATE_LIMIT" });
        if (attempt >= 3)
          throw new Error(
            "AniList rate limit persists; resume after cooldown."
          );
        nextRequestAt = now() + rateDelay(response.headers, now());
        continue;
      }
      if (!response.ok) {
        onError({ ids: batch, code: `HTTP_${response.status}` });
        throw new Error(
          `AniList HTTP ${response.status}; stop rather than bypass restrictions.`
        );
      }
      body = await response.json();
      if (body.errors || !Array.isArray(body.data?.Page?.media))
        throw new Error("AniList GraphQL response is incomplete.");
      break;
    }
    const returned = new Map(
      body.data.Page.media.map(media => [media.id, media])
    );
    for (const id of returned.keys())
      if (!batch.includes(id))
        throw new Error("Unexpected out-of-scope media.");
    for (const id of batch)
      result[id] = {
        fetched_at: new Date(now()).toISOString(),
        media: returned.get(id) ?? null
      };
    checkpoint(result, {
      completed: Object.keys(result).length,
      total: scope.length
    });
    if (response.headers.get("x-ratelimit-remaining") === "0")
      nextRequestAt = now() + rateDelay(response.headers, now());
  }
  return result;
}

async function main() {
  const { values } = parseArgs({
    options: {
      scope: { type: "string" },
      output: { type: "string" },
      "commercial-under-150-confirmed": { type: "boolean" },
      "commercial-license-confirmed": { type: "boolean" }
    }
  });
  if (!values.scope || !values.output)
    throw new Error("Provide a local --scope JSON and --output cache path.");
  const scope = JSON.parse(
    readFileSync(values.scope, "utf8").replace(/^\uFEFF/, "")
  );
  const output = resolve(values.output);
  mkdirSync(dirname(output), { recursive: true });
  const cached = existsSync(output)
    ? JSON.parse(readFileSync(output, "utf8")).entries
    : {};
  const checkpoint = (entries, progress) => {
    writeFileSync(
      output,
      JSON.stringify({
        purpose: "Yokkai current Anime/Manga catalogue audit",
        scope_snapshot_at: scope.snapshot_at,
        retention_days: 7,
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
        entries
      })
    );
    console.log(JSON.stringify(progress));
  };
  await fetchScopedMedia(scope.media_ids, {
    cached,
    purpose: "Yokkai current Anime/Manga catalogue audit",
    commercialUsageConfirmed: Boolean(
      values["commercial-under-150-confirmed"] ||
      values["commercial-license-confirmed"]
    ),
    checkpoint,
    onError: event =>
      appendFileSync(
        output + ".errors.jsonl",
        JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n"
      )
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
