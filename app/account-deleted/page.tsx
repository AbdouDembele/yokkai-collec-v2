import { getTranslations } from "next-intl/server";

import { useTranslations } from "next-intl";
import Link from "next/link";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return {
    title: t("accountDeleted"),
    robots: { index: false, follow: false }
  };
}

export default function AccountDeletedPage() {
  const t = useTranslations("page");
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="eyebrow">{t("confirmation")}</p>
      <h1 className="yk-title mt-3">{t("yourAccountHasBeenDeleted")}</h1>
      <p className="mt-6 leading-7 text-ink-2">
        {t("yourCardsKarasAvatarAndSignInIdentityHaveBeen")}
      </p>
      <Link href="/login" className="mt-8 inline-block underline">
        {t("backToSignIn")}
      </Link>
    </main>
  );
}
