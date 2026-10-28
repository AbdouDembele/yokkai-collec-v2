import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import Link from "next/link";
import { AuthShowcase } from "@/components/auth-showcase";

export function AuthExperience({
  children,
  infinityPreview = false
}: {
  children: ReactNode;
  infinityPreview?: boolean;
}) {
  const t = useTranslations("authExperience");
  return (
    <div className="yk-auth-experience">
      <section className="yk-auth-panel yk-auth-account">
        {children}
        <p className="yk-auth-account-note">
          {t("freeToJoinAWholeCollectionToMakeYourOwn")}
        </p>
        <nav className="yk-auth-help" aria-label={t("aboutYokkai")}>
          <Link href="/rarities">{t("rarities")}</Link>
          <span aria-hidden="true">·</span>
          <Link href="/rules">{t("communityRules")}</Link>
          <span aria-hidden="true">·</span>
          <Link href="/info">{t("aboutTheGame")}</Link>
        </nav>
      </section>
      <AuthShowcase infinityPreview={infinityPreview} />
    </div>
  );
}
