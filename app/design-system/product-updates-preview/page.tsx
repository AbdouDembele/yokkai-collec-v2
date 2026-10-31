import { notFound } from "next/navigation";
import { ProductUpdatesPreview } from "@/components/product-updates";
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ProductUpdatesPreview />;
}
