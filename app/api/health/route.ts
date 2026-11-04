import { checkHealth, type HealthChecks } from "@/lib/health";
import { getSupabaseConfig } from "@/utils/supabase/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow"
};

// 200 when the front, the database and Auth answer; 503 otherwise.
export async function GET() {
  let checks: HealthChecks = { database: false, auth: false };
  try {
    checks = await checkHealth(getSupabaseConfig());
  } catch {
    // Missing configuration: reported as unhealthy, without details.
  }
  const ok = checks.database && checks.auth;
  return Response.json(
    { status: ok ? "ok" : "degraded", checks },
    { status: ok ? 200 : 503, headers }
  );
}
