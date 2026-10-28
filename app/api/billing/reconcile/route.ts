import { configuredBillingService } from "@/lib/billing/server";
import { BillingError } from "@/lib/billing/config";
import {
  requireBillingReconciliation,
  billingReply,
  billingFailure
} from "@/lib/billing/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    requireBillingReconciliation(request);
    const after =
      new URL(request.url).searchParams.get("after") ??
      "00000000-0000-0000-0000-000000000000";
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        after
      )
    )
      throw new BillingError("BILLING_INVALID_REQUEST", 400);
    const result = await configuredBillingService().reconcile(after);
    return billingReply(result, result.failed ? 503 : 200);
  } catch (error) {
    return billingFailure(error, "reconcile");
  }
}
