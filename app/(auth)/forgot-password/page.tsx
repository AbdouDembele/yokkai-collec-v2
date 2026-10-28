import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { PasswordResetRequestForm } from "@/components/password-reset-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return {
    title: t("forgotPassword")
  };
}

export default async function ForgotPasswordPage({
  searchParams
}: {
  searchParams: Promise<{ lien?: string }>;
}) {
  const t = await getTranslations("page");
  const { lien } = await searchParams;
  return (
    <section className="yk-auth-panel">
      <p className="eyebrow">{t("returnToYourCollection")}</p>
      <h1 className="yk-auth-title">{t("resetYourPassword")}</h1>
      <p className="yk-auth-intro">
        {t("enterYourEmailAddressToReceiveASecureResetLink")}
      </p>
      <PasswordResetRequestForm
        invalidLink={lien === "erreur"}
        confirmationUnavailable={lien === "service"}
      />
    </section>
  );
}
