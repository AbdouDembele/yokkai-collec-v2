import { notFound } from "next/navigation";
import { MaintenanceCompensation } from "@/components/maintenance-compensation";
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <MaintenanceCompensation preview />;
}
