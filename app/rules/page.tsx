import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { InfoSection, PublicInfoPage } from "@/components/public-info-page";
import { getDiscordInviteUrl } from "@/lib/discord-invite";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legalUi");
  return {
    title: t("communityRules"),
    description: t("theFairPlayAndCommunityRulesFor")
  };
}

export default async function RulesPage() {
  const t = await getTranslations("legalUi");
  return (
    <PublicInfoPage
      eyebrow={t("playFair")}
      title={t("communityRules")}
      intro={t("yokkaiIsBuiltAroundCollectingTradingAnd")}
      discordEnabled={Boolean(getDiscordInviteUrl())}
    >
      <InfoSection number="01" title={t("respectOtherCollectors")}>
        <ul>
          <li>{t("noHarassmentHateSpeechThreatsOrTargeted")}</li>
          <li>{t("noSpamImpersonationScamsOrMisleadingTrade")}</li>
          <li>{t("keepProfilesMessagesAndSharedContentAppropriate")}</li>
        </ul>
      </InfoSection>
      <InfoSection number="02" title={t("keepTheGameFair")}>
        <ul>
          <li>{t("doNotAutomatePackOpeningsOrOther")}</li>
          <li>{t("doNotExploitBugsManipulateRequestsOr")}</li>
          <li>{t("doNotCreateAccountsToFarmReferrals")}</li>
        </ul>
      </InfoSection>
      <InfoSection number="03" title={t("tradeCarefully")}>
        <p>{t("reviewEveryCardAndKaraAmountBefore", { unit: "Kara" })}</p>
      </InfoSection>
      <InfoSection number="04" title={t("reportsAndModeration")}>
        <p>{t("useTheInAppReportToolsWhen")}</p>
      </InfoSection>
    </PublicInfoPage>
  );
}
