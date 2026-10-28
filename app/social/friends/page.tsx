import type { Metadata } from "next";
import { FriendsView } from "@/components/community-views";

export const metadata: Metadata = { title: "Friends" };

export default function Page() {
  return <FriendsView />;
}
