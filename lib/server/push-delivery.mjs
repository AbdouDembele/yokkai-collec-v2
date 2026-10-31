// Subscriptions are player input, never arbitrary server-side fetch targets.
export function validPushEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      endpoint.length <= 2048 &&
      /^(fcm\.googleapis\.com|(?:[a-z0-9-]+\.)*push\.services\.mozilla\.com|web\.push\.apple\.com|(?:[a-z0-9-]+\.)*notify\.windows\.com)$/.test(
        url.hostname
      )
    );
  } catch {
    return false;
  }
}

export async function deliverPush(subscriptions, payload, send, remove) {
  let failures = 0;
  await Promise.all(
    subscriptions.map(async subscription => {
      if (!validPushEndpoint(subscription.endpoint)) {
        failures++;
        return;
      }
      try {
        await send(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth
            }
          },
          JSON.stringify(payload)
        );
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410)
          await remove(subscription.endpoint);
        else failures++;
      }
    })
  );
  return failures;
}
