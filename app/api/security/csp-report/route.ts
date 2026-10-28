import { createCspReportHandler } from "@/lib/security/csp-report";

export const runtime = "nodejs";
export const POST = createCspReportHandler({
  siteOrigin: process.env.NEXT_PUBLIC_SITE_URL
});
