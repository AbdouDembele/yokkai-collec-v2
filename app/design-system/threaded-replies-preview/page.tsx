import { ThreadedRepliesPreview } from "@/components/threaded-replies-preview";
export default async function Page({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  return <ThreadedRepliesPreview compact={query.compact === "true"} />;
}
