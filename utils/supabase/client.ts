import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseConfig } from "@/utils/supabase/config";

export const ACCOUNT_BANNED_PATH = "/login?account=banned";
let signingOut = false;

export function createClient() {
  const { url, key, cookieName } = getSupabaseConfig();
  // A ban deletes Auth sessions, but the current access token stays valid until
  // expiry; the database then answers ACCOUNT_BANNED to every mutation.
  const bannedFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (
      !signingOut &&
      response.status >= 400 &&
      response.status < 500 &&
      (await response.clone().text()).includes('"ACCOUNT_BANNED"')
    ) {
      signingOut = true;
      void client.auth
        .signOut({ scope: "local" })
        .finally(() => window.location.replace(ACCOUNT_BANNED_PATH));
    }
    return response;
  };
  const client = createBrowserClient(url, key, {
    cookieOptions: { name: cookieName },
    global: { fetch: bannedFetch }
  });
  return client;
}
