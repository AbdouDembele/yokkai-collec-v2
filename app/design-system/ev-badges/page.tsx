import { notFound } from "next/navigation";
import { EvBadgeGallery } from "@/components/ev-badge-gallery";

export const metadata = {
  title: "EV badge studio",
  robots: { index: false, follow: false }
};

export default function EvBadgesPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <EvBadgeGallery />;
}
