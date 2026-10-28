import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";

const command = process.platform === "win32" ? "cmd.exe" : "npx";
const args =
  process.platform === "win32"
    ? ["/d", "/s", "/c", "npx.cmd", "supabase", "status", "-o", "env"]
    : ["supabase", "status", "-o", "env"];
const result = spawnSync(command, args, {
  encoding: "utf8",
  windowsHide: true
});
if (result.status !== 0)
  throw new Error(
    result.error?.message ||
      result.stderr ||
      result.stdout ||
      "Supabase local n’est pas démarré."
  );
const values = Object.fromEntries(
  result.stdout.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^([A-Z_]+)="(.*)"$/);
    return match ? [[match[1], match[2]]] : [];
  })
);
if (!values.API_URL || !values.PUBLISHABLE_KEY || !values.SECRET_KEY) {
  throw new Error("Impossible de lire la configuration Supabase locale.");
}
const api = new URL(values.API_URL);
if (api.hostname !== "127.0.0.1" && api.hostname !== "localhost") {
  throw new Error(
    "Sécurité : seule une instance Supabase locale peut être configurée."
  );
}
const contents = [
  `NEXT_PUBLIC_SUPABASE_URL=${values.API_URL}`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${values.PUBLISHABLE_KEY}`,
  "NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000",
  `SUPABASE_SECRET_KEY=${values.SECRET_KEY}`,
  "MAINTENANCE_MODE=false",
  ""
].join("\n");
await writeFile(new URL("../.env.local", import.meta.url), contents, {
  encoding: "utf8",
  mode: 0o600
});
console.log(".env.local configuré pour Supabase local uniquement.");
