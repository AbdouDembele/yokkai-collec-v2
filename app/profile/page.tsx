import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { CommunityPage } from "@/components/community-page";
import { redirect } from "next/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("profileUi");
  return { title: t("profile") };
}

export default async function Page({
  searchParams
}: {
  searchParams: Promise<{ edition?: string }>;
}) {
  if ((await searchParams).edition === "1") redirect("/settings");
  return <CommunityPage screen="profile" />;
}
