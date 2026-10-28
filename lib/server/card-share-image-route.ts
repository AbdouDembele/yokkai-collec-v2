import type { SharedCard } from "@/lib/server/card-sharing";

type Format = "og" | "story" | "square";
type Dependencies = {
  getShare: (id: string) => Promise<SharedCard | null>;
  cache: {
    getOrRender: (
      key: string,
      render: () => Promise<Uint8Array>
    ) => Promise<Uint8Array>;
  };
  render: (card: SharedCard, format: Format) => Promise<Uint8Array>;
};

const formats = new Set<Format>(["og", "story", "square"]);
const missing = () =>
  new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

export async function cardShareImageResponse(
  id: string,
  format: string,
  { getShare, cache, render }: Dependencies
) {
  if (!/^[0-9a-f]{32}$/.test(id) || !formats.has(format as Format)) {
    return missing();
  }
  let card: SharedCard | null;
  try {
    card = await getShare(id);
  } catch {
    return missing();
  }
  if (!card) return missing();
  try {
    const image = await cache.getOrRender(
      `${id}:${format}:${card.catalogueImageUrl}${card.isEvolved ? ":evolved" : ""}`,
      () => render(card, format as Format)
    );
    return new Response(Uint8Array.from(image).buffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=300, must-revalidate",
        "Content-Length": String(image.byteLength)
      }
    });
  } catch {
    // The renderer already replaces unavailable illustrations. This last guard
    // prevents an unexpected renderer failure from exposing a server error.
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" }
    });
  }
}
