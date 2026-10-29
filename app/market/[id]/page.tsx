import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { CommunityPage } from "@/components/community-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("market");
  return { title: t("auctionTitle") };
}
export default async function Page({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CommunityPage screen="auction" auctionId={id} />;
}
