import { SocialTabs } from "@/components/social-tabs";
import { SocialFeedProvider } from "@/components/social-feed-provider";
import type { ReactNode } from "react";
import { CommunityPage } from "@/components/community-page";

export default function SocialLayout({ children }: { children: ReactNode }) {
  return (
    <CommunityPage screen="friends">
      <SocialFeedProvider>
        <div className="yk-social-stack">
          <SocialTabs />
          {children}
        </div>
      </SocialFeedProvider>
    </CommunityPage>
  );
}
