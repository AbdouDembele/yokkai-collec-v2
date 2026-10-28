import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { billingSandboxEnabled } from "@/lib/billing/sandbox";
import { BillingSandboxPreview } from "@/components/billing-sandbox-preview";

export default async function Page() {
  if (!billingSandboxEnabled()) notFound();
  const user = await getCurrentUser();
  return <BillingSandboxPreview signedIn={!!user} />;
}
