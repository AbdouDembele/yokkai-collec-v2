// Health probe for external uptime monitoring (UptimeRobot). It follows the
// path of a real player request: Next.js, then Envoy -> PostgREST -> Postgres
// (a read-only, anonymous RPC) and Envoy -> Auth. Only booleans are returned:
// no versions, timings, errors or configuration.
export const HEALTH_TIMEOUT_MS = 5000;

export type HealthChecks = { database: boolean; auth: boolean };

export async function checkHealth(
  config: { url: string; key: string },
  fetchImpl: typeof fetch = fetch
): Promise<HealthChecks> {
  const probe = async (path: string, init: RequestInit) => {
    try {
      const response = await fetchImpl(new URL(path, config.url), {
        ...init,
        cache: "no-store",
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)
      });
      return response.ok;
    } catch {
      return false;
    }
  };
  const [database, auth] = await Promise.all([
    probe("/rest/v1/rpc/is_pseudo_available", {
      method: "POST",
      headers: { apikey: config.key, "Content-Type": "application/json" },
      body: JSON.stringify({ p_pseudo: "health-check" })
    }),
    probe("/auth/v1/health", { headers: { apikey: config.key } })
  ]);
  return { database, auth };
}
