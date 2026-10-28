import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { CommunityPage } from "@/components/community-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("gameUi");
  return { title: t("wishlistMetadata") };
}
export default function Page() {
  return <CommunityPage screen="wishlist" />;
}
