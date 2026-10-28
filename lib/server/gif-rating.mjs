// #379 (C2): GIF ratings players may post. The SQL fence enforces the same set.
export const ALLOWED_GIF_RATINGS = new Set(["g", "pg", "pg-13"]);
const gifId = /^[A-Za-z0-9_-]{1,64}$/;

// Reads the rating GIPHY holds for an id and records it for the SQL fence.
// Returns an HTTP status and, on 200, whether the GIF may be posted.
// `consume` runs the player's ban check and rate limit first; it resolves to
// a rating verified in the last 7 days (skip GIPHY) or null.
export async function verifyGifRating({
  id,
  apiKey,
  consume,
  fetchGif,
  record
}) {
  if (typeof id !== "string" || !gifId.test(id)) return { status: 400 };
  if (!apiKey) return { status: 503 };
  let cached = null;
  try {
    cached = await consume(id);
  } catch (error) {
    if (error?.message === "ACCOUNT_BANNED") return { status: 403 };
    if (error?.message === "GIF_VERIFY_RATE_LIMITED") return { status: 429 };
    // Only before its migration is the RPC missing; any other failure refuses.
    if (error?.code !== "PGRST202" && error?.code !== "42883")
      return { status: 503 };
  }
  if (typeof cached === "string")
    return { status: 200, allowed: ALLOWED_GIF_RATINGS.has(cached) };
  let item;
  try {
    const response = await fetchGif(
      `https://api.giphy.com/v1/gifs/${id}?api_key=${encodeURIComponent(apiKey)}`
    );
    if (response.status === 404) return { status: 200, allowed: false };
    if (!response.ok) return { status: 502 };
    item = (await response.json())?.data;
  } catch {
    return { status: 502 };
  }
  const rating =
    typeof item?.rating === "string" ? item.rating.trim().toLowerCase() : "";
  if (item?.id !== id || !/^[a-z0-9-]{1,16}$/.test(rating))
    return { status: 502 };
  try {
    await record(id, rating);
  } catch {
    // Before the migration the RPC does not exist; afterwards a failed record
    // only means the SQL fence refuses the GIF (GIF_RATING_REJECTED).
  }
  return { status: 200, allowed: ALLOWED_GIF_RATINGS.has(rating) };
}
