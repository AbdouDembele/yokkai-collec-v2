import { getTranslations } from "next-intl/server";
import { LocaleSelector } from "@/components/locale-controls";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/utils/supabase/server";
import { ChooseUsernameForm } from "@/components/choose-username-form";
import { SignOutButton } from "@/components/sign-out-button";
import "@/styles/auth.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("authForm");
  return {
    title: t("chooseYourUsername"),
    robots: { index: false, follow: false }
  };
}

export default async function ChooseUsernamePage() {
  const t = await getTranslations("authForm");
  if (!(await getCurrentUser())) redirect("/login");
  const { data: required, error } = await createClient(await cookies()).rpc(
    "is_pseudo_required"
  );
  // On a failed check, show the form: choose_pseudo refuses a chosen username.
  if (!error && required !== true) redirect("/boosters");
  return (
    <div className="yk-auth-shell">
      <main id="main-content" className="yk-auth-main">
        <section className="yk-auth-panel yk-username-step">
          <p className="eyebrow">{t("oneLastStep")}</p>
          <h1 className="yk-auth-title">{t("chooseYourUsername")}</h1>
          <p className="yk-auth-intro">{t("collectorNameExplanation")}</p>
          <ChooseUsernameForm />
          <div className="yk-username-step-signout">
            <LocaleSelector />
            <SignOutButton />
          </div>
        </section>
      </main>
    </div>
  );
}
