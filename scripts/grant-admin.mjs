import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

const { values } = parseArgs({ options: { email: { type: "string" } } });
const email = values.email?.trim().toLowerCase();
if (!email)
  throw new Error("Usage : npm run admin:grant -- --email admin@exemple.fr");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key)
  throw new Error("Variables Supabase serveur manquantes dans .env.local.");
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false }
});
let page = 1;
let user;
while (!user) {
  const { data, error } = await client.auth.admin.listUsers({
    page,
    perPage: 1000
  });
  if (error) throw error;
  user = data.users.find(candidate => candidate.email?.toLowerCase() === email);
  if (user || data.users.length < 1000) break;
  page++;
}
if (!user) throw new Error(`Compte introuvable : ${email}`);
const { error } = await client
  .from("admin_users")
  .upsert({ user_id: user.id }, { onConflict: "user_id" });
if (error) throw error;
console.log(`Accès admin accordé à ${email}.`);
