import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import Link from "next/link";
import { LocaleSelector } from "@/components/locale-controls";
import Image from "next/image";
import { getCurrentUser } from "@/lib/auth/session";
import { PasswordUpdateForm } from "@/components/password-reset-forms";
import "@/styles/auth.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return {
    title: t("newPassword")
  };
}
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  const t = await getTranslations("page");
  const user = await getCurrentUser();
  return (
    <div className="yk-auth-shell">
      <header className="yk-auth-header">
        <Link
          href="/"
          className="yk-auth-brand"
          aria-label={t("yokkaiCollecHome")}
        >
          <Image
            className="yk-auth-brand-image"
            src="/assets/brand-logo-ice-retro.png"
            alt=""
            width={1672}
            height={941}
            priority
          />
        </Link>
        <Link href="/login" className="yk-auth-return">
          <span aria-hidden="true">←</span> {t("signIn")}
        </Link>
        <LocaleSelector />
      </header>
      <main className="yk-auth-main">
        <section className="yk-auth-panel">
          <p className="eyebrow">{t("keepYourCollectionSafe")}</p>
          <h1 className="yk-auth-title">{t("chooseANewPassword")}</h1>
          <p className="yk-auth-intro">
            {t("useAUniquePasswordThatYouDonTUseOn")}
          </p>
          {user ? (
            <PasswordUpdateForm />
          ) : (
            <div className="yk-auth-success">
              <p role="alert" className="auth-error">
                {t("thisPasswordResetLinkIsInvalidOrHasExpired")}
              </p>
              <Link href="/forgot-password" className="yk-auth-link">
                {t("requestANewLink")}
              </Link>
            </div>
          )}
        </section>
      </main>
      <footer className="yk-auth-footer">
        {t("yokkaiCollecANewDiscoveryInEveryCard")}
      </footer>
    </div>
  );
}
