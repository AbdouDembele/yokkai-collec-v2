import type { Metadata } from "next";
import { CommunityPage } from "@/components/community-page";

export const metadata: Metadata = { title: "Auction" };
export default async function Page({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CommunityPage screen="auction" auctionId={id} />;
}
