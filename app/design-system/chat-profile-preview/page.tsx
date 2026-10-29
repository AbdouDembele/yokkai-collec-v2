import { notFound } from "next/navigation";
import { ChatProfilePreview } from "@/components/chat-profile-preview";
export default async function Page({
  searchParams
}: {
  searchParams: Promise<{ friend?: string; full?: string; blocked?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const p = await searchParams;
  return (
    <ChatProfilePreview
      friend={p.friend === "1"}
      fullProfile={p.full === "1"}
      blocked={p.blocked === "1"}
    />
  );
}
