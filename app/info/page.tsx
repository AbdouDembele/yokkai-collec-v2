import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { InfoSection, PublicInfoPage } from "@/components/public-info-page";
import { getDiscordInviteUrl } from "@/lib/discord-invite";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legalUi");
  return {
    title: t("about"),
    description: t("learnAboutYokkaiCollecAndHowThe")
  };
}

export default async function InfoPage() {
  const t = await getTranslations("legalUi");
  return (
    <PublicInfoPage
      eyebrow={t("aboutTheProject")}
      title={t("whatIsYokkai")}
      intro={t("yokkaiCollecIsAFanMadeOnline")}
      discordEnabled={Boolean(getDiscordInviteUrl())}
    >
      <InfoSection number="01" title={t("collect")}>
        <p>{t("openRegularAndDecisionPacksDiscoverCards")}</p>
      </InfoSection>
      <InfoSection number="02" title={t("connect")}>
        <p>{t("addFriendsExchangePrivateMessagesBuildTrade")}</p>
      </InfoSection>
      <InfoSection number="03" title={t("buildYourIdentity")}>
        <p>{t("customizeYourPublicProfileShowcaseFavoriteCards")}</p>
      </InfoSection>
      <InfoSection number="04" title={t("anUnofficialFanProject")}>
        <p>{t("yokkaiCollecIsNotAffiliatedWithOr")}</p>
      </InfoSection>
      <InfoSection number="05" title={t("stayConnected")}>
        <p>{t("joinTheYokkaiDiscordFromTheIcon")}</p>
      </InfoSection>
    </PublicInfoPage>
  );
}
