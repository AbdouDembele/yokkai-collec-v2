export function matchesProRequestOrigin(
  request: Request,
  configuredOrigin: string,
  development: boolean
) {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  if (origin === configuredOrigin) return true;
  if (!development || !origin) return false;
  try {
    const configured = new URL(configuredOrigin);
    const submitted = new URL(origin);
    const target = new URL(request.url);
    const loopback = (url: URL) =>
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return (
      loopback(configured) &&
      loopback(submitted) &&
      loopback(target) &&
      !submitted.username &&
      !submitted.password &&
      submitted.origin === origin &&
      target.origin === submitted.origin &&
      configured.protocol === submitted.protocol &&
      configured.port === submitted.port
    );
  } catch {
    return false;
  }
}
