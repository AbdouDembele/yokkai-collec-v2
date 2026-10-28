import type { Metadata } from "next";
import { PrivateMessagesPreview } from "@/components/private-messages-preview";

export const metadata: Metadata = {
  title: "Private messages preview",
  robots: { index: false, follow: false }
};
export default function Page() {
  return <PrivateMessagesPreview />;
}
