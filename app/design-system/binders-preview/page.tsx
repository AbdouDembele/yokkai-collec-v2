import { notFound } from "next/navigation";
import { BindersPreview } from "@/components/binders-preview";
export default async function Page({
  searchParams
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const p = await searchParams;
  return <BindersPreview mode={p.mode ?? "home"} />;
}
