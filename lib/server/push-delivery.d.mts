export type PushSubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
};
export function validPushEndpoint(endpoint: string): boolean;
export function deliverPush(
  subscriptions: PushSubscriptionRow[],
  payload: {
    title: string;
    body: string;
    url: string;
    tag: string;
    lang: string;
  },
  send: (
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string
  ) => Promise<unknown>,
  remove: (endpoint: string) => Promise<void>
): Promise<number>;
