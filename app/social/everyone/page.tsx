import type { Metadata } from "next";
import { SocialFeed } from "@/components/social-feed";

export const metadata: Metadata = { title: "Everyone" };

export default function Page() {
  return <SocialFeed source="public" />;
}
