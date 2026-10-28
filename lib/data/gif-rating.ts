// #379 (C2): ask the server to verify a GIF's rating before posting it.
// "unknown" lets the post proceed: the SQL fence decides once it is deployed.
export async function checkGifRating(
  id: string
): Promise<"allowed" | "rejected" | "unknown"> {
  try {
    const response = await fetch("/api/gifs/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id })
    });
    if (!response.ok) return "unknown";
    const { allowed } = (await response.json()) as { allowed?: unknown };
    return allowed === true
      ? "allowed"
      : allowed === false
        ? "rejected"
        : "unknown";
  } catch {
    return "unknown";
  }
}
