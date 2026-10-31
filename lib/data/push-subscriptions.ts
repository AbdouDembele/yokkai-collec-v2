import { createClient } from "@/utils/supabase/client";

export async function disablePushSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  const { error } = await createClient().from("push_subscriptions").delete()
    .eq("endpoint", subscription.endpoint);
  if (error) throw error;
  if (!(await subscription.unsubscribe())) throw new Error("PUSH_UNSUBSCRIBE_FAILED");
}
