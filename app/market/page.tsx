import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { MarketHeading } from "@/components/market-heading";
import { CommunityPage } from "@/components/community-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("market");
  return { title: t("title") };
}
export default function Page() {
  return <CommunityPage screen="market" pageHeading={<MarketHeading />} />;
}
