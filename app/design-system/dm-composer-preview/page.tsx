import { DmComposerPreview } from "@/components/dm-composer-preview";
export default async function Page({
  searchParams
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const p = await searchParams;
  return <DmComposerPreview docked={p.mode !== "modal"} />;
}
