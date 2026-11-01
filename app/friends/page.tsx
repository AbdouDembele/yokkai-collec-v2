import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { CommunityPage } from "@/components/community-page";
import { FriendsView } from "@/components/community-views";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("socialFriends");
  return { title: t("friends") };
}

export default function Page() {
  return (
    <CommunityPage screen="friends">
      <FriendsView />
    </CommunityPage>
  );
}
