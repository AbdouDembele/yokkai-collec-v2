import { configuredBillingService } from "@/lib/billing/server";
import { BillingError } from "@/lib/billing/config";
import { billingBody, billingReply, billingFailure } from "@/lib/billing/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const signature = request.headers.get("stripe-signature");
    if (!signature) throw new BillingError("BILLING_SIGNATURE_INVALID", 400);
    await configuredBillingService().webhook(
      await billingBody(request),
      signature
    );
    return billingReply({ received: true });
  } catch (error) {
    return billingFailure(error, "webhook");
  }
}
