import { notFound } from "next/navigation";
import { MarketReleasePreview } from "@/components/market-release-preview";
export default async function Page({
  searchParams
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  return <MarketReleasePreview mode={(await searchParams).mode ?? "market"} />;
}
