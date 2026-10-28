import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { CommunityPage } from "@/components/community-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("profileUi");
  return { title: t("profile") };
}
export default async function Page({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CommunityPage screen="profile" playerId={decodeURIComponent(id)} />;
}
