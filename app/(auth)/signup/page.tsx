import { getTranslations, getLocale } from "next-intl/server";
import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { AuthExperience } from "@/components/auth-experience";
import { OAuthButtons } from "@/components/oauth-buttons";
import { normalizeReferralCode } from "@/lib/auth/forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return {
    alternates: { canonical: "/" },
    title: t("signUp"),
    description: t("createYourYokkaiCollecAccountAndStartCollecting"),
    openGraph: {
      title: "Yokkai Collec'",
      description: t("openPacksCollectYourFavoriteCharactersAndTrade"),
      type: "website",
      locale: (await getLocale()) === "fr" ? "fr_FR" : "en_US",
      url: "/signup"
    },
    twitter: { card: "summary_large_image" }
  };
}

export default async function SignUpPage({
  searchParams
}: {
  searchParams: Promise<{ ref?: string | string[] }>;
}) {
  const t = await getTranslations("page");
  const params = await searchParams;
  const referralCode = normalizeReferralCode(
    Array.isArray(params.ref) ? params.ref[0] : params.ref
  );
  return (
    <AuthExperience>
      <p className="eyebrow">{t("yourAdventureAwaits")}</p>
      <h1 className="yk-auth-title">{t("startYourCollection")}</h1>
      <p className="yk-auth-intro">
        {t("oneUsernameOneFirstCardLetFateTakeCareOf")}
      </p>
      <OAuthButtons referralCode={referralCode ?? undefined} />
      <AuthForm mode="signup" referralCode={referralCode ?? undefined} />
    </AuthExperience>
  );
}
