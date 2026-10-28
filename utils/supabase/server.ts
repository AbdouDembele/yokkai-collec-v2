import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseConfig } from "@/utils/supabase/config";
import { serverAuthFetch } from "@/utils/supabase/auth-fetch";

export function createClient(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  const { url, key, cookieName } = getSupabaseConfig();

  return createServerClient(url, key, {
    cookieOptions: { name: cookieName },
    global: { fetch: serverAuthFetch(url) },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Server Components cannot write cookies. The proxy refreshes them
          // before rendering; Server Actions and Route Handlers can write here.
        }
      }
    }
  });
}
