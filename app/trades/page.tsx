import type { Metadata } from "next";
import { CommunityPage } from "@/components/community-page";

export const metadata: Metadata = { title: "Trades" };
export default function Page() {
  return <CommunityPage screen="trades" />;
}
