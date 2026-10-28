"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { getSupabaseConfig } from "@/utils/supabase/config";
import { serverAuthFetch } from "@/utils/supabase/auth-fetch";
import {
  authError,
  normalizeReferralCode,
  pseudoValidationError,
  SIGNUP_POLICY_VERSION,
  signupPolicyValidationError,
  type AuthState
} from "@/lib/auth/forms";
import {
  isOAuthProvider,
  OAUTH_PROVIDER_NAMES,
  OAUTH_REFERRAL_COOKIE
} from "@/lib/auth/oauth";

function configuredSiteOrigin() {
  const configuredUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.NODE_ENV !== "production" ? "http://localhost:3000" : "");
  try {
    const site = new URL(configuredUrl);
    const secureProtocol =
      process.env.NODE_ENV === "production"
        ? site.protocol === "https:"
        : ["http:", "https:"].includes(site.protocol);
    if (!secureProtocol || site.username || site.password) return undefined;
    return site.origin;
  } catch {
    return undefined;
  }
}

export async function startOAuth(
  provider: string,
  referralCode?: string
): Promise<{ url?: string; error?: string; errorKey?: string }> {
  // Use a configured origin, never an untrusted Host header.
  const siteOrigin = configuredSiteOrigin();
  if (!isOAuthProvider(provider) || !siteOrigin) return { error: authError() };
  try {
    const { url, key } = getSupabaseConfig();
    // A disabled provider makes GoTrue show a raw JSON error page: ask first.
    const settings = await serverAuthFetch(url)(
      `${url.replace(/\/$/, "")}/auth/v1/settings`,
      { headers: { apikey: key }, cache: "no-store" }
    );
    if (!settings.ok) return { error: authError() };
    const { external } = await settings.json();
    if (external?.[provider] !== true)
      return {
        error: `${OAUTH_PROVIDER_NAMES[provider]} sign-in isn't available yet. Use your email and password for now.`,
        errorKey: "providerUnavailable"
      };

    const cookieStore = await cookies();
    // PKCE: the code verifier is stored in a cookie read back by /auth/callback.
    // Discord: GoTrue always requests exactly the "identify email" scopes.
    const { data, error } = await createClient(
      cookieStore
    ).auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${siteOrigin}/auth/callback`,
        skipBrowserRedirect: true
      }
    });
    if (error || !data.url)
      return { error: authError(error?.code, error?.status) };

    const code = normalizeReferralCode(referralCode);
    if (code)
      cookieStore.set(OAUTH_REFERRAL_COOKIE, code, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 30 * 60
      });
    else cookieStore.delete(OAUTH_REFERRAL_COOKIE);
    return { url: data.url };
  } catch {
    return { error: authError() };
  }
}

export async function chooseUsername(
  _state: AuthState,
  form: FormData
): Promise<AuthState> {
  const value = form.get("pseudo");
  const pseudo = typeof value === "string" ? value.trim() : "";
  const values = { email: "", pseudo };
  const pseudoError = pseudoValidationError(pseudo);
  const policyError = signupPolicyValidationError(form);
  if (pseudoError || policyError)
    return {
      fields: {
        ...(pseudoError ? { pseudo: pseudoError } : {}),
        ...(policyError ? { acceptedPolicies: policyError } : {})
      },
      values
    };
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { error } = await supabase.rpc("choose_pseudo", {
      p_pseudo: pseudo,
      p_referral_code: normalizeReferralCode(
        cookieStore.get(OAUTH_REFERRAL_COOKIE)?.value
      )
    });
    if (error?.message.includes("PSEUDO_TAKEN"))
      return {
        fields: { pseudo: "That username is already taken. Try another one." },
        values
      };
    if (error && !error.message.includes("PSEUDO_ALREADY_CHOSEN"))
      return {
        error: "We couldn't save your username. Please try again.",
        values
      };
    if (!error) {
      // Same metadata as an email signup. The proxy skips its database check
      // once the refreshed token carries it; the database stays authoritative.
      await supabase.auth.updateUser({
        data: {
          pseudo,
          signup_policies: {
            version: SIGNUP_POLICY_VERSION,
            accepted_at: new Date().toISOString()
          }
        }
      });
      await supabase.auth.refreshSession();
    }
    cookieStore.delete(OAUTH_REFERRAL_COOKIE);
  } catch {
    return {
      error: "We couldn't save your username. Please try again.",
      values
    };
  }
  revalidatePath("/", "layout");
  redirect("/boosters");
}
