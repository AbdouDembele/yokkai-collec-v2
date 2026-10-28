import { getSharedCard } from "@/lib/server/card-sharing";
import { renderSharedCardImage } from "@/lib/server/card-share-image";
import { cardShareImageResponse } from "@/lib/server/card-share-image-route";
import { RenderCache } from "@/lib/server/image-cache";

export const runtime = "nodejs";
const cache = new RenderCache(32 * 1024 * 1024, 2);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; format: string }> }
) {
  const { id, format } = await params;
  return cardShareImageResponse(id, format, {
    getShare: getSharedCard,
    cache,
    render: renderSharedCardImage
  });
}
