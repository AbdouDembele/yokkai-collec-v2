import { TradePathsPreview } from "@/components/trade-paths-preview";
export default async function Page({
  searchParams
}: {
  searchParams: Promise<{
    entry?: string;
    slow?: string;
    failRefresh?: string;
    reject?: string;
  }>;
}) {
  const p = await searchParams;
  return (
    <TradePathsPreview
      entry={p.entry}
      slow={p.slow === "1"}
      failRefresh={p.failRefresh === "1"}
      reject={p.reject === "1"}
    />
  );
}
