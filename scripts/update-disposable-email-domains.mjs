import {
  readFileSync,
  existsSync,
  readdirSync,
  writeFileSync,
  renameSync,
  unlinkSync
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import {
  fileURLToPath,
  pathToFileURL,
  domainToASCII,
  domainToUnicode
} from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { parse } from "tldts";

const root = fileURLToPath(new URL("../", import.meta.url));
const repository = "disposable-email-domains/disposable-email-domains";
export const snapshotPath = "data/disposable-email-domains.json";
const initialMigration = "20261031170000_disposable_signup_policy.sql";
const readJSON = path => JSON.parse(readFileSync(path, "utf8"));

export function validateDomainList(text, previousCount = 0) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 4_000_000)
    throw new Error("Invalid blocklist size");
  const domains = new Set();
  for (const line of text.split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith("#")) continue;
    if (/[\\/:@?#%\[\]\s]/.test(value))
      throw new Error("Blocklist contains a URL or invalid domain");
    const domain = domainToASCII(value.normalize("NFKC"))
      .toLowerCase()
      .replace(/\.$/, "");
    if (
      !domain ||
      domain.length > 253 ||
      domain
        .split(".")
        .some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    )
      throw new Error("Invalid blocklist domain");
    const parsed = parse(domain, { allowPrivateDomains: true });
    if (!parsed.domain || parsed.isIp || parsed.publicSuffix === domain)
      throw new Error("Blocklist contains an IP or public suffix");
    domains.add(domain);
  }
  if (
    domains.size < 5_000 ||
    domains.size > 200_000 ||
    (previousCount &&
      (domains.size < previousCount * 0.85 || domains.size > previousCount * 3))
  )
    throw new Error("Abnormal blocklist count; previous snapshot retained");
  if (
    ["yopmail.com", "mailinator.com", "10minutemail.com"].filter(value =>
      domains.has(value)
    ).length < 2
  )
    throw new Error("Blocklist sanity markers missing");
  return [...domains].sort();
}

export function domainRules(snapshot) {
  const rules = new Map();
  for (const domain of snapshot.domains) {
    rules.set(domain, false);
    rules.set(domainToUnicode(domain).normalize("NFKC").toLowerCase(), false);
  }
  for (const domain of snapshot.allowlist) {
    rules.set(domain, true);
    rules.set(domainToUnicode(domain).normalize("NFKC").toLowerCase(), true);
  }
  return [...rules.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
const quote = value => "'" + value.replaceAll("'", "''") + "'";
export function renderRules(rules) {
  if (!rules.length) return "";
  return (
    "insert into public.signup_email_domain_rules(domain,allowed) values\n" +
    rules
      .map(([domain, allowed]) => `(${quote(domain)},${allowed})`)
      .join(",\n") +
    "\non conflict(domain) do update set allowed=excluded.allowed;"
  );
}
export function renderRefresh(previous, next) {
  const before = new Map(domainRules(previous)),
    after = new Map(domainRules(next));
  const removed = [...before.keys()].filter(domain => !after.has(domain));
  const changed = [...after].filter(
    ([domain, allowed]) => !before.has(domain) || before.get(domain) !== allowed
  );
  return (
    "begin;\n\n-- Public-source domain policy refresh; no user data is read or modified.\n" +
    (removed.length
      ? `delete from public.signup_email_domain_rules where domain in (${removed.map(quote).join(",")});\n`
      : "") +
    renderRules(changed) +
    "\n\ncommit;\n"
  );
}
function atomicWrite(path, content) {
  const temporary = join(dirname(path), "." + randomUUID() + ".tmp");
  try {
    writeFileSync(temporary, content, { flag: "wx" });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
async function download(url, fetchImpl) {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(30_000),
    headers: {
      "User-Agent": "Yokkai-domain-policy-updater",
      Accept: "application/vnd.github+json"
    }
  });
  if (!response.ok)
    throw new Error(
      `Upstream HTTP ${response.status}; previous snapshot retained`
    );
  const bytes = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 4_000_000) throw new Error("Upstream response too large");
    bytes.push(chunk);
  }
  return Buffer.concat(bytes).toString("utf8");
}
export async function updateDomains({
  directory = root,
  fetchImpl = fetch,
  initialize = false,
  now = new Date()
} = {}) {
  const path = resolve(directory, snapshotPath);
  const previous = existsSync(path) ? readJSON(path) : undefined;
  if (!previous && !initialize) throw new Error("Missing initial snapshot");
  if (previous && initialize)
    throw new Error("Initial snapshot already exists");
  const commit = JSON.parse(
    await download(
      `https://api.github.com/repos/${repository}/commits?per_page=1`,
      fetchImpl
    )
  )[0]?.sha;
  if (!/^[a-f0-9]{40}$/.test(commit))
    throw new Error("Invalid upstream commit");
  const content = await download(
    `https://raw.githubusercontent.com/${repository}/${commit}/disposable_email_blocklist.conf`,
    fetchImpl
  );
  const domains = validateDomainList(content, previous?.domains.length);
  const allowlist = readJSON(
    resolve(directory, "data/disposable-email-allowlist.json")
  );
  if (
    !Array.isArray(allowlist) ||
    !allowlist.length ||
    allowlist.length > 100 ||
    new Set(allowlist).size !== allowlist.length ||
    allowlist.some(
      domain =>
        typeof domain !== "string" ||
        domainToASCII(domain) !== domain ||
        !parse(domain).domain
    )
  )
    throw new Error("Invalid allowlist");
  if (
    previous &&
    JSON.stringify([domains, allowlist]) ===
      JSON.stringify([previous.domains, previous.allowlist])
  )
    return { changed: false, count: domains.length };
  const snapshot = {
    source: repository,
    upstreamCommit: commit,
    updatedAt: now.toISOString(),
    sha256: createHash("sha256").update(content).digest("hex"),
    allowlist,
    domains
  };
  let migration, sql;
  if (initialize) {
    migration = initialMigration;
    sql = readFileSync(
      resolve(directory, "scripts/sql/disposable-email-policy.sql"),
      "utf8"
    ).replace("-- @DOMAIN_RULES@", renderRules(domainRules(snapshot)));
  } else {
    const existing = readdirSync(resolve(directory, "supabase/migrations"))
      .filter(file => /^\d{14}_.*\.sql$/.test(file))
      .sort();
    const timestamp = now.toISOString().replace(/\D/g, "").slice(0, 14);
    const next = String(
      BigInt(timestamp) > BigInt(existing.at(-1).slice(0, 14))
        ? BigInt(timestamp)
        : BigInt(existing.at(-1).slice(0, 14)) + 1n
    );
    migration = `${next}_refresh_disposable_email_domains.sql`;
    sql = renderRefresh(previous, snapshot);
  }
  const migrationPath = resolve(directory, "supabase/migrations", migration);
  if (existsSync(migrationPath)) throw new Error("Migration already exists");
  // Both outputs are fully validated before replacing the local snapshot.
  atomicWrite(migrationPath, sql);
  try {
    atomicWrite(path, JSON.stringify(snapshot, null, 2) + "\n");
  } catch (error) {
    unlinkSync(migrationPath);
    throw error;
  }
  return {
    changed: true,
    count: domains.length,
    migration,
    upstreamCommit: commit
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    console.log(
      JSON.stringify(
        await updateDomains({
          initialize: process.argv.includes("--initialize")
        })
      )
    );
  } catch (error) {
    console.error(
      "disposable_email_update_failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    process.exitCode = 1;
  }
}
