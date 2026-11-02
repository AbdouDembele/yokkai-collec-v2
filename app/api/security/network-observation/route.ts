import { cookies } from "next/headers";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { getSupabaseConfig } from "@/utils/supabase/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff"
};
const identityPattern = /^v[1-9][0-9]*:[a-f0-9]{64}$/;

function empty(status = 204) {
  return new Response(null, { status, headers: privateHeaders });
}

export async function POST(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return empty(403);

  const networkIdentity = request.headers.get("x-yokkai-ip-hmac") ?? "";
  // Local development and environments where the trusted Cloudflare chain is
  // intentionally disabled remain usable. No client-provided fallback exists.
  if (!identityPattern.test(networkIdentity)) return empty();

  const client = createClient(await cookies());
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return empty();

  const secret =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return empty(503);
  const { url } = getSupabaseConfig();
  const admin = createAdminClient(url, secret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
  const result = await admin.rpc("record_anticheat_network_observation", {
    p_user_id: data.user.id,
    p_network_identity: networkIdentity
  });
  if (result.error) {
    console.error("ANTICHEAT_NETWORK_OBSERVATION_FAILED");
    return empty(503);
  }
  return empty();
}

export function GET() {
  return new Response(null, {
    status: 405,
    headers: { ...privateHeaders, Allow: "POST" }
  });
}
export const HEAD = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
export const OPTIONS = GET;
