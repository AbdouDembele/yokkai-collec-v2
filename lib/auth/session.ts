import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import type { UserAppMetadata, UserMetadata } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";

export type SessionUser = {
  id: string;
  email?: string;
  user_metadata: UserMetadata;
  app_metadata: UserAppMetadata;
};

// Identity from the verified session JWT. With asymmetric Auth signing keys,
// getClaims checks the signature locally against the cached JWKS (no Auth
// round trip per page). With a symmetric secret it falls back to getUser, so
// it is never weaker than before. Claims can lag a metadata change until the
// next token refresh: use getVerifiedUser for fresh profile fields.
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || typeof claims?.sub !== "string" || !claims.sub) return null;
  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : undefined,
    user_metadata: claims.user_metadata ?? {},
    app_metadata: claims.app_metadata ?? {}
  };
});

// Full user fetched from Auth: fresh metadata, created_at, identities, and a
// session revoked server-side is refused immediately.
export const getVerifiedUser = cache(async () => {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
});

// Request-local only: React clears this between server render requests.
// Cookie/JWT identity remains authoritative, with no shared cross-player cache.
const getRequestClient = cache(async () => createClient(await cookies()));
const getRequestGameInfo = cache(
  async (client: ReturnType<typeof createClient>) => client.rpc("get_game_info")
);

export async function getCurrentPseudo(userId: string) {
  if (!userId) return null;
  const supabase = await getRequestClient();
  // Identity comes exclusively from the session JWT, never the caller's userId.
  const { data, error } = await getRequestGameInfo(supabase);
  const pseudo = data?.user?.name;
  return !error && typeof pseudo === "string" ? pseudo : null;
}

export async function getCurrentKarasBalance(
  existingClient?: ReturnType<typeof createClient>
) {
  const supabase = existingClient ?? (await getRequestClient());
  const { data, error } = await getRequestGameInfo(supabase);
  if (error || !data || typeof data !== "object") return undefined;
  const balance = (data as { karasBalance?: unknown }).karasBalance;
  return typeof balance === "number" ? balance : undefined;
}
