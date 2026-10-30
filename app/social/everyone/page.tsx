import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { SocialFeed } from "@/components/social-feed";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("socialUi.everyone") };
}

export default function Page() {
  return <SocialFeed source="public" />;
}
